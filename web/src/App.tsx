import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { WorldCanvas, type Camera } from "./WorldCanvas";
import { worldStore } from "./store";
import { connection, validateConfig } from "./service";
import { Icon, Mascot, type IconName } from "./icons";
import { WalletControl } from "./wallet";
import { Modal } from "./Modal";
import { LearningLab } from "./LearningLab";
import {
  Chronicle,
  HealthPanel,
  Inspector,
  Residents,
  SidePanel,
  ToolsPanel,
} from "./Panels";
import { actionName, eventText, number } from "./format";
import type {
  Creature,
  Entity,
  ServiceConfig,
  Session,
  WorldState,
} from "./types";
type Panel =
  "residents" | "inspector" | "chronicle" | "health" | "tools" | "visit" | "lab" | null;
const CONFIG_KEY = "stratoks-service-v1";
const getSaved = (): ServiceConfig | null => {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null");
  } catch {
    return null;
  }
};
export default function App() {
  const state = useSyncExternalStore(
    worldStore.subscribe,
    worldStore.getSnapshot,
  );
  const camera = useRef<Camera>(null);
  const connectionNotice = useRef<HTMLDivElement>(null);
  const [noticeHeight, setNoticeHeight] = useState(0);
  useLayoutEffect(() => {
    const notice = connectionNotice.current;
    if (!notice) return;
    const measure = () => setNoticeHeight(notice.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(notice);
    return () => observer.disconnect();
  }, [!!state.error]);
  const [panel, setPanel] = useState<Panel>(null);
  const [modal, setModal] = useState<"settings" | "help" | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [session, setSession] = useState<Session | null>(null);
  const [speed, setSpeed] = useState(4);
  const [bubbles, setBubbles] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [motion, setMotion] = useState(true);
  const [now, setNow] = useState(Date.now());
  const onSession = useCallback((s: Session | null) => setSession(s), []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReducedMotion(media.matches);
    media.addEventListener("change", handler);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      media.removeEventListener("change", handler);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const saved = getSaved();
      try {
        const hosted = await fetch("./world-config.json", { cache: "no-store" })
          .then(r => r.ok ? r.json() : null).catch(() => null);
        // The disposable loopback launcher must not reconnect a previously saved
        // remote world. Regular static hosting still honors the user's settings.
        const localDemo = hosted?.isolated === true &&
          ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
          ["127.0.0.1", "localhost", "[::1]"].includes(new URL(hosted.httpUrl).hostname);
        const cfg = localDemo ? hosted : saved ?? hosted;
        if (!cancelled && cfg?.httpUrl) connection.connect(cfg);
      } catch {
        if (!cancelled && saved)
          worldStore.patch({
            error:
              "Saved connection settings could not be loaded. Open Settings to correct them.",
          });
      }
    }
    load();
    return () => {
      cancelled = true;
      connection.stop();
    };
  }, []);
  const previousWorld = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = state.world?.worldId;
    if (previousWorld.current && id && previousWorld.current !== id) {
      setSelected(null);
      setPanel(null);
      camera.current?.center();
    }
    previousWorld.current = id;
  }, [state.world?.worldId]);
  const hasWorld = !!state.world;
  const demo = state.mode === "demo";
  const live = state.mode === "connected";
  const active = live || demo;
  const stale = hasWorld && !active;
  const creatures = [...state.entities.values()].filter((e) =>
    e.k.startsWith("c:"),
  ) as Creature[];
  const selectedEntity = selected
    ? state.entities.get(`c:${selected}`)
    : undefined;
  const select = useCallback((id: number) => {
    setSelected(id);
    setPanel("inspector");
  }, []);
  const focus = useCallback((e: Entity) => {
    camera.current?.center(e);
    if (innerWidth <= 600) setPanel(null);
  }, []);
  const closePanel = () => {
    setPanel(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('.dock button[aria-pressed="true"]')
        ?.focus(),
    );
  };
  const title =
    panel === "lab"
      ? "Learning lab"
      : panel === "residents"
      ? "Meet the residents"
      : panel === "inspector"
        ? "A little life"
        : panel === "chronicle"
          ? "World history"
          : panel === "health"
            ? "World health"
            : panel === "visit"
              ? "Visit the clearing"
              : demo
                ? "Local test tools"
                : "Developer tools";
  const status = demo
    ? "Local demo"
    : live
      ? state.demoMode
        ? "Local test server"
        : "Shared world"
      : state.mode === "connecting"
        ? "Connecting…"
        : state.mode === "reconnecting"
          ? "Reconnecting…"
          : "Not connected";
  const recent = state.events
    .filter((e) =>
      [
        "birth",
        "death",
        "shelter_complete",
        "bond",
        "intervention",
        "extinction",
      ].includes(e.type),
    )
    .at(-1);
  return (
    <div
      className={`app ${panel ? "has-panel" : ""} ${state.error ? "has-connection-notice" : ""}`}
      style={
        { "--connection-space": state.error ? `${noticeHeight + 12}px` : "0px" } as CSSProperties
      }
      data-mode={state.mode}
      data-world-tick={state.tick}
      data-world-id={state.world?.worldId ?? ""}
    >
      <a className="skip-link" href="#world-canvas">
        Skip to world
      </a>
      <header className="app-header">
        <button
          className="brand"
          aria-label="Stratoks, center the world"
          onClick={() => {
            setPanel(null);
            camera.current?.center();
          }}
        >
          <Mascot size={44} />
          <span>
            <h1>
              stratoks<span className="brand-period">.</span>
            </h1>
            <span className="brand-caption">A little world, unfolding</span>
          </span>
        </button>
        <div className="header-center">
          <span className={`connection-label ${active ? "online" : ""}`}>
            <span className="status-dot" />
            {status}
          </span>
          <span className="phase-label">Phase 2A · Prototype</span>
        </div>
        <div className="header-utilities">
          <button
            className="icon-button help-button"
            aria-label="About this world"
            onClick={() => setModal("help")}
          >
            <Icon name="help" />
          </button>
          <button
            className="icon-button"
            aria-label="Open settings"
            onClick={() => setModal("settings")}
          >
            <Icon name="settings" />
          </button>
          <WalletControl onSession={onSession} serviceConnected={live} />
        </div>
      </header>
      <main className="world-stage" aria-label="Stratoks world">
        <WorldCanvas
          ref={camera}
          state={state}
          selected={selected}
          motion={motion && !reducedMotion && !stale}
          bubbles={bubbles}
          onSelect={select}
          onZoom={setZoom}
        />
        <div className="world-vignette" aria-hidden="true" />
        <div className="world-heading">
          <div className="world-name">
            <Icon name="world" size={18} />
            <span>The clearing</span>
            <span className="small muted">
              {hasWorld
                ? `${state.world!.width} × ${state.world!.height}`
                : "World observer"}
            </span>
          </div>
          {hasWorld ? (
            <div className="world-subtitle">
              <span
                className={`connection-label mobile-status ${active ? "online" : ""}`}
              >
                <span className="status-dot" />
                {status}
              </span>
              <span>
                {demo
                  ? "Private tab · resets on reload"
                  : state.demoMode
                    ? "Demo server · local testing"
                    : "One world, shared by everyone"}
              </span>
            </div>
          ) : (
            <span className="world-subtitle">
              An autonomous settlement, one small life at a time.
            </span>
          )}
        </div>
        {hasWorld && (
          <div className="world-metrics" aria-label="World metrics">
            <Metric
              icon="people"
              label="Residents"
              value={number(state.world?.population)}
            />
            <Metric
              icon="leaf"
              label="Food"
              value={number(state.world?.food)}
            />
            <Metric
              icon="home"
              label="Shelters"
              value={number(state.world?.sheltersComplete)}
            />
            <Metric
              icon="heart"
              label="Pair bonds"
              value={number(state.world?.pairs)}
            />
          </div>
        )}
        {!hasWorld && panel !== "lab" && (
          <section className="welcome">
            <div className="welcome-art">
              <Mascot size={88} />
              <span className="welcome-sprig" aria-hidden="true">
                <Icon name="leaf" size={26} />
              </span>
            </div>
            <h2>
              Small lives.
              <br />A shared world.
            </h2>
            <p>
              Watch them forage, build, bond, and learn from the lives they
              lead.
            </p>
            <div className="offline-note">
              <span className="status-dot" />
              <span>
                {state.mode === "connecting"
                  ? "Connecting to the world…"
                  : "World server not connected"}
              </span>
            </div>
            <button
              className="primary full"
              onClick={() => {
                connection.demo();
                setPanel(null);
                setSelected(null);
                setSpeed(4);
              }}
            >
              <Icon name="play" size={17} />
              Explore local demo
              <Icon name="arrow" size={18} />
            </button>
            <button
              className="text-button configure-button"
              onClick={() => setModal("settings")}
            >
              Connect a world server
              <Icon name="chevron" size={16} />
            </button>
            <button className="text-button full lab-entry" onClick={() => setPanel("lab")}>Try learning scenarios</button>
            <p className="fineprint">Private demo. No wallet needed.</p>
          </section>
        )}
        {hasWorld && state.world!.status === "extinct" && (
          <div className="extinction-banner">
            <Icon name="leaf" />
            <div>
              <strong>This world has fallen quiet.</strong>
              <p>
                History is preserved. Only an authenticated developer can
                explicitly start another world.
              </p>
            </div>
            <button className="secondary" onClick={() => setPanel("chronicle")}>
              View history
            </button>
          </div>
        )}
        {state.error && (
          <div className="connection-notice" role="status" ref={connectionNotice}>
            <Icon name="signal" size={18} />
            <span>{state.error}</span>
            <button
              className="text-button"
              onClick={() => setModal("settings")}
            >
              Settings
            </button>
          </div>
        )}
        {hasWorld && !panel && (
          <div className="observation-hint">
            <span className="hint-icon">
              <Icon name="eye" size={19} />
            </span>
            <span>
              Select a Stratok.
              <br />
              <span className="muted small">
                Every little life has a story.
              </span>
            </span>
          </div>
        )}
        {selectedEntity && !panel && (
          <button
            className="selected-hint"
            onClick={() => setPanel("inspector")}
          >
            <Mascot size={32} />
            {selectedEntity.name}
            <Icon name="chevron" size={16} />
          </button>
        )}
        {panel && (hasWorld || panel === "lab") && (
          <SidePanel
            title={title}
            subtitle={
              panel === "residents"
                ? `${creatures.length} lives in the clearing`
                : panel === "inspector"
                  ? "Nobody owns a Stratok."
                  : undefined
            }
            onClose={closePanel}
          >
            {panel === "lab" && <LearningLab />}
            {panel === "residents" && (
              <Residents creatures={creatures} onSelect={select} />
            )}
            {panel === "inspector" && selected !== null && (
              <Inspector
                id={selected}
                state={state}
                onFocus={focus}
                onSelect={select}
                onLab={() => setPanel("lab")}
              />
            )}
            {panel === "chronicle" && <Chronicle key={`${connection.config.httpUrl}:${state.world?.worldId}`} state={state} />}
            {panel === "health" && <HealthPanel state={state} />}
            {panel === "tools" && (
              <ToolsPanel
                key={`${state.mode === "demo" ? "demo" : connection.config.httpUrl}:${state.world?.worldId}:${session?.address.toLowerCase() ?? "signed-out"}`}
                state={state}
                session={session}
                selected={selectedEntity}
              />
            )}
            {panel === "visit" && (
              <VisitPanel
                state={state}
                session={session}
                selected={selectedEntity}
              />
            )}
          </SidePanel>
        )}
        <div className={`camera-controls ${panel ? "with-panel" : ""}`}>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => camera.current?.zoomIn()}
          >
            <Icon name="plus" />
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => camera.current?.zoomOut()}
          >
            <Icon name="minus" />
          </button>
          <div className="control-rule" />
          <button
            className="icon-button"
            aria-label="Center world"
            onClick={() => camera.current?.center()}
          >
            <Icon name="center" />
          </button>
        </div>
        <div className="world-coordinates" aria-hidden="true">
          <svg width="40" height="42" viewBox="0 0 40 42">
            <path d="M20 9 29 29 20 25 11 29Z" fill="#587451" />
            <path d="M20 9v16l-9 4Z" fill="#f8f6dc" />
            <text x="20" y="8" textAnchor="middle" fill="#38513c" fontSize="10">
              N
            </text>
          </svg>
        </div>
        <div className="scene-caption">
          {hasWorld
            ? "Original prototype art · Template speech"
            : "Illustrated terrain · Start the demo to see life"}
        </div>
      </main>
      <footer className="world-footer">
        <div className="world-update">
          <span className="status-line">
            <span className={`status-dot ${active ? "green" : ""}`} />
            {demo
              ? "Local demo"
              : live
                ? "World connected"
                : hasWorld
                  ? "View frozen"
                  : "World server not connected"}
          </span>
          <span className="small muted">
            {state.lastUpdate
              ? `Tick ${number(state.tick)} · updated ${Math.max(0, Math.floor((now - state.lastUpdate) / 1000))}s ago`
              : "Static landscape preview"}
          </span>
        </div>
        <nav className="dock" aria-label="World tools">
          {(
            [
              { id: null, icon: "world", label: "Observe" },
              { id: "residents", icon: "people", label: "Residents" },
              { id: "chronicle", icon: "history", label: "History" },
              { id: "visit", icon: "heart", label: "Visit" },
              { id: "tools", icon: "spark", label: "Tools" },
            ] as { id: Panel; icon: IconName; label: string }[]
          ).map((item) => (
            <button
              key={item.label}
              aria-pressed={
                panel === item.id ||
                (item.id === "residents" && panel === "inspector")
              }
              disabled={!hasWorld && item.id !== null}
              onClick={() => setPanel(panel === item.id ? null : item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="footer-right">
          {demo ? (
            <div className="speed-controls" aria-label="Local demo speed">
              <button
                className="icon-button"
                aria-label={speed ? "Pause local demo" : "Resume local demo"}
                onClick={() => {
                  const next = speed ? 0 : 4;
                  setSpeed(next);
                  connection.setDemoSpeed(next);
                }}
              >
                <Icon name={speed ? "pause" : "play"} size={16} />
              </button>
              <button
                className="speed-button"
                aria-label={`Demo speed ${speed || 0} ticks per second. Change speed.`}
                onClick={() => {
                  const next = speed === 1 ? 4 : speed === 4 ? 12 : 1;
                  setSpeed(next);
                  connection.setDemoSpeed(next);
                }}
              >
                {speed === 0 ? "Paused" : `${speed}×`}
              </button>
            </div>
          ) : recent ? (
            <span className="latest-event">{eventText(recent)}</span>
          ) : (
            <span className="small muted">
              Drag to explore · Scroll to zoom
            </span>
          )}
          {hasWorld && (
            <button
              className="icon-button health-button"
              aria-label="View world health"
              aria-pressed={panel === "health"}
              onClick={() => setPanel(panel === "health" ? null : "health")}
            >
              <Icon name="signal" size={19} />
            </button>
          )}
        </div>
      </footer>
      <div className="sr-only" role="status">
        {state.mode === "demo"
          ? "Private local demo started. Use Residents to meet a Stratok."
          : state.mode === "connected"
            ? "World server connected."
            : state.mode === "reconnecting"
              ? "World connection lost. Reconnecting."
              : ""}
      </div>
      {modal === "settings" && (
        <Settings
          onClose={() => setModal(null)}
          onConfigured={() => {
            setPanel(null);
            setSelected(null);
          }}
          motion={motion && !reducedMotion}
          onMotion={setMotion}
          reduced={reducedMotion}
          bubbles={bubbles}
          onBubbles={setBubbles}
          state={state}
          onHelp={() => setModal("help")}
        />
      )}
      {modal === "help" && (
        <Modal title="A world to observe" onClose={() => setModal(null)}>
          <div className="about-mascot">
            <Mascot size={76} />
          </div>
          <p>
            Stratoks find food, build shelters, form bonds, and raise offspring.
            Nobody owns them. A shared server keeps their world running, even
            with no viewers.
          </p>
          <h3>Find your way</h3>
          <ul className="help-list">
            <li>Drag the world to pan. Pinch or scroll to zoom.</li>
            <li>
              Select a yellow Stratok, or open Residents to inspect needs and
              memories.
            </li>
            <li>
              With the world focused, arrow keys pan, + / − zoom, and Home
              recenters.
            </li>
            <li>
              History shows births, deaths, resources, and settlement events.
            </li>
          </ul>
          <h3>Learning, without the mystery</h3>
          <p>
            A local learning model adjusts preferences from the outcomes of
            actions. Wallet memories influence approach and avoidance. Speech
            comes from labeled event templates. There is no external AI service
            or claim of consciousness.
          </p>
          <button className="secondary full" onClick={() => { setModal(null); setPanel("lab"); }}>Try isolated learning scenarios</button>
          <h3>A clear boundary</h3>
          <p>
            The local demo is private to this tab and resets on reload. It
            starts after 900 ticks of the same engine in mb-v1 mode, seeded with 24 Stratoks.
            The shared world requires an owner-operated VPS.
          </p>
          <p className="fineprint">
            Phase 2A prototype. No tokens, NFTs, ownership, contracts, pools, or
            payments.
          </p>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <span className="metric-icon">
        <Icon name={icon} size={19} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
function Settings({
  onClose,
  onConfigured,
  motion,
  onMotion,
  reduced,
  bubbles,
  onBubbles,
  state,
  onHelp,
}: {
  onClose: () => void;
  onConfigured: () => void;
  motion: boolean;
  onMotion: (v: boolean) => void;
  reduced: boolean;
  bubbles: boolean;
  onBubbles: (v: boolean) => void;
  state: WorldState;
  onHelp: () => void;
}) {
  const initial = connection.config.httpUrl ? connection.config : getSaved() ?? connection.config;
  const [http, setHttp] = useState(initial.httpUrl);
  const [ws, setWs] = useState(initial.wsUrl);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const config = validateConfig({ httpUrl: http, wsUrl: ws });
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      } catch {
        /* Still usable without storage. */
      }
      connection.connect(config);
      onConfigured();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="World settings" onClose={onClose}>
      <form onSubmit={connect}>
        <h3>Connect to the shared world</h3>
        <p className="muted small">
          Use the HTTPS and WSS URLs of the owner’s world server. Settings are
          saved in this browser.
        </p>
        <label>
          World service URL
          <input
            type="url"
            name="world-http"
            autoComplete="url"
            placeholder="https://your-world-server"
            value={http}
            onChange={(e) => setHttp(e.target.value)}
            required
            aria-invalid={!!error}
            aria-describedby={error ? "config-error" : undefined}
          />
        </label>
        <label>
          WebSocket URL <span className="muted small">(optional)</span>
          <input
            type="url"
            name="world-ws"
            placeholder="wss://your-world-server/ws"
            value={ws}
            onChange={(e) => setWs(e.target.value)}
          />
        </label>
        <p className="fineprint">
          Leave WebSocket URL blank to derive it from the service URL. HTTP/WS
          is allowed only on localhost from a local preview.
        </p>
        <p className="error" id="config-error" role="alert">
          {error}
        </p>
        <button className="primary full" disabled={saving} type="submit">
          {saving ? "Connecting…" : "Connect to world"}
          <Icon name="link" size={18} />
        </button>
        {(initial.httpUrl || state.world) && (
          <button
            className="secondary full"
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem(CONFIG_KEY);
              } catch {}
              connection.disconnect();
              onConfigured();
              onClose();
            }}
          >
            Disconnect and clear saved settings
          </button>
        )}
      </form>
      <div className="settings-divider" />
      <h3>Observation preferences</h3>
      <label className="toggle-label">
        <span>
          Animate creatures
          <span className="small muted">
            {reduced
              ? "Your device’s reduced-motion setting is respected."
              : "Stops cosmetic motion; the world keeps running."}
          </span>
        </span>
        <input
          type="checkbox"
          checked={motion}
          onChange={(e) => onMotion(e.target.checked)}
          disabled={reduced}
        />
      </label>
      <label className="toggle-label">
        <span>
          Show speech bubbles
          <span className="small muted">
            Short, event-triggered template phrases.
          </span>
        </span>
        <input
          type="checkbox"
          checked={bubbles}
          onChange={(e) => onBubbles(e.target.checked)}
        />
      </label>
      <button className="secondary full" onClick={onHelp}>
        <Icon name="help" size={18} />
        About this world
      </button>
    </Modal>
  );
}
function VisitPanel({
  state,
  session,
  selected,
}: {
  state: WorldState;
  session: Session | null;
  selected: Entity | undefined;
}) {
  const [x, setX] = useState(28),
    [y, setY] = useState(28),
    [placed, setPlaced] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!placed || !session) return;
    let cancelled = false;
    const timer = setInterval(() => {
      connection
        .request<{ ok: boolean }>("/api/visitor/presence", { x, y }, true)
        .then((result) => {
          if (!cancelled && !result.ok) {
            setPlaced(false);
            setNotice("");
            setError("The world’s visitor spaces are full. Try again later.");
          }
        })
        .catch(() => {
          if (cancelled) return;
          setPlaced(false);
          setNotice("");
          setError("Presence expired. Sign in and place your visitor again.");
        });
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [placed, session, x, y]);
  async function action(type: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const presence = await connection.request<{ ok: boolean }>(
        "/api/visitor/presence", { x, y }, true,
      );
      if (!presence.ok) {
        setPlaced(false);
        setError("The world’s visitor spaces are full. Try again later.");
        return;
      }
      setPlaced(true);
      if (type !== "presence")
        await connection.request("/api/visitor/action", { type }, true);
      setNotice(
        type === "gift_food"
          ? "Food was left nearby. Stratoks can remember this wallet’s help."
          : type === "startle"
            ? "The nearest Stratok was startled. This wallet’s harmful action can be remembered."
            : "Your visitor is in the world.",
      );
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (state.mode === "demo")
    return (
      <div className="empty-state">
        <Mascot size={72} />
        <h3>This is your private demo</h3>
        <p>
          Wallet visits happen on the shared server. Use Tools to try bounded
          food, healing, fire, and storm effects locally.
        </p>
      </div>
    );
  if (!session)
    return (
      <div className="empty-state">
        <Icon name="wallet" size={32} />
        <h3>Be a remembered visitor</h3>
        <p>
          Connect a wallet, then sign in to the world. A signature proves
          control of your account without a transaction.
        </p>
        <p className="muted small">
          Creatures learn whether this wallet helps or harms them. Wallets are
          accounts, not unique people.
        </p>
      </div>
    );
  return (
    <>
      <p className="muted">
        Choose a place to visit. Nearby creatures can learn from your actions.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action("presence");
        }}
      >
        <div className="form-pair">
          <label>
            Tile X
            <input
              type="number"
              required
              min="0"
              max={(state.world?.width ?? 56) - 1}
              value={x}
              onChange={(e) => {
                setX(Number(e.target.value));
                setPlaced(false);
              }}
            />
          </label>
          <label>
            Tile Y
            <input
              type="number"
              required
              min="0"
              max={(state.world?.height ?? 56) - 1}
              value={y}
              onChange={(e) => {
                setY(Number(e.target.value));
                setPlaced(false);
              }}
            />
          </label>
        </div>
        {selected && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setX(Math.round(selected.x));
              setY(Math.round(selected.y));
              setPlaced(false);
            }}
          >
            Visit near {selected.name}
          </button>
        )}
        <button className="secondary full" disabled={busy} type="submit">
          <Icon name="world" size={18} />
          {placed ? "Refresh presence" : "Place visitor"}
        </button>
      </form>
      <button
        className="primary full"
        disabled={busy || !placed}
        onClick={() => action("gift_food")}
      >
        <Icon name="leaf" size={18} />
        Leave food
      </button>
      <p className="fineprint">
        Food gifts have a 120-tick cooldown by default.
      </p>
      <details className="harm-details">
        <summary>Behavior experiment: startle</summary>
        <p className="small">
          This harms the nearest creature by 3 health. At most 20 per wallet,
          with a default 240-tick cooldown.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          I understand this harms a creature.
        </label>
        <button
          className="danger-button full"
          disabled={busy || !placed || !confirm}
          onClick={() => action("startle")}
        >
          Startle nearby creature
        </button>
      </details>
      <p className="error" role="alert">
        {error}
      </p>
      <p className="success" role="status">
        {notice}
      </p>
      <p className="fineprint">
        Presence refreshes while this panel is open and expires after 300 ticks
        without a refresh.
      </p>
    </>
  );
}
