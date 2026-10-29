import { worldStore } from "./store";
import type {
  Detail,
  HistoryPoint,
  Intervention,
  ServiceConfig,
  Session,
  Snapshot,
  Delta,
  EventPage,
} from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfterTicks?: number,
    public retryAfterSec?: number,
  ) {
    super(
      code === "rate_limited"
        ? `Too many requests. ${retryAfterSec ? `Try again in ${retryAfterSec} seconds.` : "Wait briefly, then retry."}`
        : code === "event_history_busy"
          ? "Saved history is busy. Wait briefly, then retry this page."
        : code === "not_durable_retry_same_id"
          ? "The server could not save this change yet. Retry the same request with this wallet."
        : code === "id_reused_with_different_request"
          ? "This wallet already used this request ID for a different change. Check the chronicle before applying another effect."
        : code === "cooldown"
        ? `Let the world recover. Try again in ${retryAfterTicks ?? "?"} ticks.`
        : code === "auth_required"
          ? "Your session ended. Sign in again."
          : code === "developer_only"
            ? "This wallet is not an authorized developer."
            : code === "window_limit"
              ? "The intervention limit has been reached. Wait for the next world window."
              : code === "origin_not_allowed"
                ? "The server must allow this website’s origin before signing in."
                : `Server rejected the request: ${code.replaceAll("_", " ")}.`,
    );
  }
}
const localHost = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);
export function validateConfig(raw: ServiceConfig): ServiceConfig {
  const http = new URL(raw.httpUrl.trim());
  const ws = new URL(
    raw.wsUrl.trim() ||
      raw.httpUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws",
  );
  if (
    http.username ||
    http.password ||
    ws.username ||
    ws.password ||
    http.hash ||
    ws.hash ||
    http.search ||
    ws.search
  )
    throw new Error(
      "Use service URLs without credentials, fragments, or query strings.",
    );
  if (
    http.protocol !== "https:" &&
    !(http.protocol === "http:" && localHost(http.hostname))
  )
    throw new Error("Use HTTPS, or HTTP on localhost for testing.");
  if (
    ws.protocol !== "wss:" &&
    !(ws.protocol === "ws:" && localHost(ws.hostname))
  )
    throw new Error("Use WSS, or WS on localhost for testing.");
  if (
    location.protocol === "https:" &&
    (http.protocol !== "https:" || ws.protocol !== "wss:")
  )
    throw new Error(
      "This HTTPS page needs HTTPS/WSS. Preview locally to use a local test server.",
    );
  return { httpUrl: http.href.replace(/\/$/, ""), wsUrl: ws.href };
}
export class WorldConnection {
  config: ServiceConfig = { httpUrl: "", wsUrl: "" };
  session: Session | null = null;
  private socket: WebSocket | null = null;
  private worker: Worker | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private epoch = 0;
  private calls = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  private requestId = 0;
  private attempt = 0;
  async request<T>(path: string, body?: unknown, auth = false): Promise<T> {
    const epoch = this.epoch;
    if (!this.config.httpUrl)
      throw new Error("Configure a world server first.");
    if (auth && (!this.session || this.session.expiresAt <= Date.now())) {
      this.session = null;
      throw new ApiError(401, "auth_required");
    }
    let response: Response;
    try {
      response = await fetch(this.config.httpUrl + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(auth ? { Authorization: `Bearer ${this.session!.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
        credentials: "omit",
      });
    } catch {
      throw new Error(
        "Cannot reach the world server. Check its URL, connection, and allowed origin, then retry.",
      );
    }
    if (epoch !== this.epoch) throw new Error("World connection changed. Retry in the current world.");
    const data = await response.json();
    if (epoch !== this.epoch) throw new Error("World connection changed. Retry in the current world.");
    if (!response.ok) {
      if (response.status === 401) this.session = null;
      throw new ApiError(
        response.status,
        data.error ?? "unknown_error",
        data.retryAfterTicks,
        data.retryAfterSec,
      );
    }
    return data as T;
  }
  stop() {
    this.epoch++;
    this.session = null;
    this.socket?.close();
    this.socket = null;
    this.worker?.terminate();
    this.worker = null;
    this.timers.forEach(clearTimeout);
    this.intervals.forEach(clearInterval);
    this.timers = [];
    this.intervals = [];
    this.calls.forEach((c) => c.reject(new Error("World connection changed.")));
    this.calls.clear();
  }
  disconnect() {
    this.stop();
    worldStore.reset();
  }
  connect(raw: ServiceConfig) {
    const config = validateConfig(raw);
    this.stop();
    this.config = config;
    this.attempt = 0;
    worldStore.reset("connecting");
    const epoch = this.epoch;
    this.open(epoch);
    const refreshHistory = async () => {
      try {
        const r = await this.request<{ history: HistoryPoint[] }>(
          "/api/history?limit=300",
        );
        if (epoch === this.epoch) worldStore.patch({ history: r.history });
      } catch {
        /* WS status remains the source of connection health. */
      }
    };
    this.intervals.push(setInterval(refreshHistory, 15000));
  }
  private open(epoch: number) {
    if (epoch !== this.epoch) return;
    const url = new URL(this.config.wsUrl);
    url.searchParams.set("after", String(worldStore.state.seq));
    const socket = new WebSocket(url);
    this.socket = socket;
    let heard = Date.now();
    let awaitingSnapshot = true;
    const heartbeat = setInterval(() => {
      const allowance = Math.max(
        15_000,
        (worldStore.state.world?.tickMs ?? 1000) * 4,
      );
      if (Date.now() - heard > allowance)
        socket.close(4000, "World updates timed out");
      else if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "ping" }));
    }, 5000);
    this.intervals.push(heartbeat);
    socket.onmessage = (event) => {
      if (epoch !== this.epoch) return;
      heard = Date.now();
      try {
        const data = JSON.parse(event.data);
        if (!["snapshot", "delta"].includes(data.type)) return;
        if (data.type === "delta" && awaitingSnapshot) return;
        if (worldStore.apply(data as Snapshot | Delta) === "resync") {
          awaitingSnapshot = true;
          worldStore.patch({
            mode: "reconnecting",
            error: "Resynchronizing world state…",
          });
          socket.send(
            JSON.stringify({
              type: "resync",
              after:
                data.epoch !== worldStore.state.serverEpoch ||
                data.meta?.worldId !== worldStore.state.world?.worldId
                  ? 0
                  : worldStore.state.seq,
            }),
          );
        } else {
          awaitingSnapshot = false;
          this.attempt = 0;
          worldStore.patch({ mode: "connected", error: null });
        }
      } catch {
        worldStore.patch({
          error: "The server sent an unreadable update. Reconnecting…",
        });
        socket.close(4001, "Invalid protocol message");
      }
    };
    socket.onclose = () => {
      clearInterval(heartbeat);
      if (epoch !== this.epoch) return;
      worldStore.patch({
        mode: "reconnecting",
        error: worldStore.state.world
          ? "Connection lost. Retrying automatically; the last world view is frozen."
          : "Cannot connect to the world. Retrying automatically.",
      });
      const delay = Math.min(15000, 1000 * 2 ** this.attempt++);
      this.timers.push(setTimeout(() => this.open(epoch), delay));
    };
    socket.onerror = () => {
      if (epoch === this.epoch)
        worldStore.patch({
          error: "Cannot connect. Check the server URL and allowed origin.",
        });
    };
  }
  demo() {
    this.stop();
    worldStore.reset("connecting");
    this.config = { httpUrl: "", wsUrl: "" };
    const worker = new Worker(new URL("./demo.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;
    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "response") {
        const call = this.calls.get(data.id);
        this.calls.delete(data.id);
        if (data.error) call?.reject(new Error(data.error));
        else call?.resolve(data.result);
      } else if (data.type === "snapshot" || data.type === "delta") {
        worldStore.apply(data);
        worldStore.patch({ mode: "demo" });
      }
    };
    worker.onerror = () =>
      worldStore.patch({
        mode: "disconnected",
        error: "The local demo could not start. Reload and try again.",
      });
    worker.postMessage({ type: "start" });
  }
  private demoCall<T>(type: string, body?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.calls.set(id, { resolve, reject });
      this.worker?.postMessage({ type, body, id });
      const timer = setTimeout(() => {
        if (this.calls.has(id)) {
          this.calls.delete(id);
          reject(new Error("The local simulation did not respond."));
        }
      }, 10000);
      this.timers.push(timer);
    });
  }
  detail(id: number) {
    return this.worker
      ? this.demoCall<Detail>("detail", id)
      : this.request<Detail>(`/api/creatures/${id}`);
  }
  eventPage(after = 0, limit = 100) {
    if (!Number.isSafeInteger(after) || after < 0 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
      throw new Error("Use an event cursor of 0 or more and a page size from 1 to 500.");
    return this.request<EventPage>(`/api/events?after=${after}&limit=${limit}`);
  }
  intervene(body: Intervention) {
    return this.worker
      ? this.demoCall<{ duplicate: boolean; record: { appliedTick: number } }>(
          "intervene",
          body,
        )
      : this.request<{ duplicate: boolean; record: { appliedTick: number } }>(
          "/api/dev/interventions",
          body,
          true,
        );
  }
  setDemoSpeed(speed: number) {
    this.worker?.postMessage({ type: "speed", body: speed });
  }
}
export const connection = new WorldConnection();
