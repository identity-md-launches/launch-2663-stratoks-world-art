import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Mascot, type IconName } from "./icons";
import type {
  Creature,
  Detail,
  Entity,
  EventPage,
  HistoryPoint,
  Intervention,
  Session,
  WorldState,
} from "./types";
import { actionName, eventText, number } from "./format";
import { connection, ApiError } from "./service";
import { BrainBehavior } from "./BrainBehavior";
import { legacyPendingKey, parsePending, pendingKey as makePendingKey } from "./pending";
export function SidePanel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <aside
      className="side-panel"
      aria-labelledby="panel-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="panel-head">
        <div>
          <h2 id="panel-title" tabIndex={-1} ref={heading}>
            {title}
          </h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close panel"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </aside>
  );
}
export function Residents({
  creatures,
  onSelect,
}: {
  creatures: Creature[];
  onSelect: (id: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = creatures.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "hungry" && c.hunger >= 70) ||
        (filter === "young" && ["infant", "juvenile"].includes(c.stage))),
  );
  return (
    <>
      <label className="search-field">
        <Icon name="search" size={18} />
        <input
          aria-label="Find a Stratok"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a Stratok…"
          type="search"
        />
      </label>
      <div className="segment" aria-label="Filter residents">
        {[
          ["all", "Everyone"],
          ["hungry", "Hungry"],
          ["young", "Young"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="small muted result-count">
        {filtered.length} of {creatures.length} residents
      </p>
      <div className="resident-list">
        {filtered.map((c) => (
          <button
            className="resident-row"
            key={c.id}
            onClick={() => onSelect(c.id)}
          >
            <span className="resident-avatar">
              <Mascot size={42} mood={c.act === "REST" ? "rest" : "happy"} />
            </span>
            <span className="resident-name">
              <strong>{c.name}</strong>
              <span className="small muted">{actionName(c.act)}</span>
            </span>
            <span className="resident-health" title="Health">
              <Icon name="heart" size={13} />
              {c.health}
            </span>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <p>
            {creatures.length
              ? "No residents match this view."
              : "There are no living residents."}
          </p>
          {creatures.length > 0 && (
            <button
              className="secondary"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </>
  );
}
function Need({
  name,
  value,
  inverse = false,
  icon,
}: {
  name: string;
  value: number;
  inverse?: boolean;
  icon: IconName;
}) {
  return (
    <div className="need">
      <div>
        <span>
          <Icon name={icon} size={16} />
          {name}
        </span>
        <strong>
          {Math.round(value)}
          <span className="muted"> / 100</span>
        </strong>
      </div>
      <meter
        min={0}
        max={100}
        low={25}
        high={70}
        optimum={inverse ? 0 : 100}
        value={value}
        aria-label={name}
        className={(inverse ? value > 75 : value < 30) ? "warning-meter" : ""}
      />
    </div>
  );
}
export function Inspector({
  id,
  state,
  onFocus,
  onSelect,
  onLab,
}: {
  id: number;
  state: WorldState;
  onFocus: (e: Entity) => void;
  onSelect: (id: number) => void;
  onLab: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("life");
  const [retry, setRetry] = useState(0);
  const detailSource = state.mode === "demo" ? "private-worker" : connection.config.httpUrl;
  useEffect(() => {
    setDetail(null);
    setError("");
    setTab("life");
  }, [id, detailSource, state.serverEpoch, state.world?.worldId]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      let delay = 2500;
      try {
        const d = await connection.detail(id);
        if (!cancelled) {
          setDetail(d);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        if (e instanceof ApiError && e.retryAfterSec)
          delay = Math.max(delay, e.retryAfterSec * 1000);
      } finally {
        if (!cancelled) timer = setTimeout(load, delay);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, detailSource, state.serverEpoch, state.world?.worldId, retry]);
  const compact = state.entities.get(`c:${id}`) as Creature | undefined;
  const c = compact ?? detail;
  if (detail?.dead || (!compact && detail))
    return (
      <div className="empty-state">
        <Icon name="leaf" size={32} />
        <h3>{detail.name ?? "This Stratok"} has died</h3>
        <p>
          Cause: {detail.cause ?? "See the chronicle for the recorded cause."}
        </p>
        <p className="muted">
          Their place in the world’s history is preserved.
        </p>
      </div>
    );
  if (!c) return error ? <div className="error" role="alert">{error}<button className="text-button" onClick={() => setRetry((v) => v + 1)}>Retry details</button></div> : <p className="muted">Loading this Stratok’s story…</p>;
  const partner = detail?.relationships.find((r) => r.id === c.partner);
  return (
    <>
      <div className="creature-identity">
        <div className="portrait">
          <Mascot size={90} mood={c.act === "REST" ? "rest" : "happy"} />
        </div>
        <div>
          <h3>{c.name}</h3>
          <p className="muted small">
            {c.stage} · Generation {detail?.generation ?? "…"}
          </p>
          <span className="activity-label">
            <span className="status-dot" />
            {actionName(c.act)}
          </span>
        </div>
      </div>
      {c.bubble && (
        <div className="speech">
          <p>“{c.bubble.text}”</p>
          <span className="small muted">
            Template speech · {c.bubble.cause.replaceAll("_", " ")}
          </span>
        </div>
      )}
      <div className="segment" aria-label="Inspector view">
        {[
          ["life", "Needs"],
          ["memory", "Memories"],
          ["learning", "Learning"],
        ].map(([v, l]) => (
          <button key={v} aria-pressed={tab === v} onClick={() => setTab(v)}>
            {l}
          </button>
        ))}
      </div>
      {tab === "life" && (
        <>
          <div className="needs">
            <Need name="Health" value={c.health} icon="heart" />
            <Need name="Energy" value={c.energy} icon="sun" />
            <Need name="Hunger" value={c.hunger} inverse icon="leaf" />
          </div>
          <p className="fineprint">
            Higher hunger means a greater need for food.
          </p>
          <dl className="facts">
            <div>
              <dt>Age</dt>
              <dd>{number(c.age)} ticks</dd>
            </div>
            <div>
              <dt>Shelter</dt>
              <dd>{c.home ? `Shelter #${c.home}` : "Still finding a home"}</dd>
            </div>
            <div>
              <dt>Pair bond</dt>
              <dd>
                {c.partner ? (
                  <button
                    className="text-button"
                    onClick={() => onSelect(c.partner!)}
                  >
                    {partner?.name ?? `Stratok #${c.partner}`}
                  </button>
                ) : (
                  "Not bonded"
                )}
              </dd>
            </div>
            <div>
              <dt>Carrying</dt>
              <dd>{c.carry ?? "Nothing"}</dd>
            </div>
            {c.pregnant && (
              <div>
                <dt>Life event</dt>
                <dd>Expecting offspring</dd>
              </div>
            )}
          </dl>
          {detail && (
            <>
              <h3 className="section-heading">Connections</h3>
              {detail.relationships.length ? (
                <ul className="relationship-list">
                  {detail.relationships.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      <button
                        className="text-button"
                        onClick={() => onSelect(r.id)}
                      >
                        {r.name}
                      </button>
                      <span className="small muted">
                        {r.affinity > 0.5
                          ? "Close"
                          : r.affinity > 0
                            ? "Familiar"
                            : "Wary"}{" "}
                        · {r.affinity.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No lasting relationships yet.</p>
              )}
              <h3 className="section-heading">Personality</h3>
              <div className="trait-list">
                {Object.entries(detail.personality).map(([k, v]) => (
                  <span key={k}>
                    {k} <strong>{Math.round(v * 100)}%</strong>
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {tab === "memory" && (
        <>
          <h3 className="section-heading">What stays with {c.name}</h3>
          {detail?.memories.length ? (
            <ol className="story-list">
              {detail.memories.map((m, i) => (
                <li key={`${m.tick}-${i}`}>
                  <span className="story-dot" />
                  <p>{m.text}</p>
                  <span className="small muted">
                    Tick {number(m.tick)} · {m.kind.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              {detail
                ? "No lasting memories yet. Experiences will appear here."
                : "Loading memories…"}
            </p>
          )}
        </>
      )}
      {tab === "learning" && (
        <>
          <BrainBehavior detail={detail} local={state.mode === "demo"} stale={!!error || !["connected", "demo"].includes(state.mode)} onLab={onLab} />
          <details className="brain-disclosure">
          <summary>Learning history</summary>
          <p className="fineprint">Linear-policy updates count retained changes to the original weights, separately from circuit updates. Recent decisions span active policies. Mean reward includes all completed actions.</p>
          <dl className="facts">
            <div>
              <dt>Linear-policy updates</dt>
              <dd>{number(detail?.learning.updates)}</dd>
            </div>
            <div>
              <dt>Mean reward</dt>
              <dd>{number(detail?.learning.meanReward, 2)}</dd>
            </div>
            <div>
              <dt>Known food sites</dt>
              <dd>{number(detail?.knownFood)}</dd>
            </div>
          </dl>
          <h3 className="section-heading">Recent decisions</h3>
          {detail?.decisions.map((d, i) => (
            <div className="decision" key={`${d.tick}-${i}`}>
              <strong>{actionName(d.action)}</strong>
              <span className="small muted">
                Tick {number(d.tick)} · utility {d.utility}
              </span>
              <p className="small">
                {d.why
                  .map((w) => w.replaceAll("_", " ").replace("=", " "))
                  .join(" · ") || "Exploring available actions"}
              </p>
            </div>
          ))}
          </details>
          <h3 className="section-heading">Visitor memories</h3>
          <p className="fineprint">Authenticated wallet opinions are game-level memory, separate from the fly-inspired circuit.</p>
          {detail?.walletOpinions.length ? (
            detail.walletOpinions.map((w) => (
              <div className="decision" key={w.wallet}>
                <strong>{w.wallet}</strong>
                <span className="small">
                  {w.value > 0.15
                    ? "Helpful"
                    : w.value < -0.15
                      ? "Harmful"
                      : "Uncertain"}{" "}
                  · {w.interactions} interactions
                </span>
              </div>
            ))
          ) : (
            <p className="muted small">
              {detail
                ? "No learned wallet opinions yet. Signed-in visitors can build a history with these creatures."
                : "Loading visitor memories…"}
            </p>
          )}
          <p className="fineprint">
            Scores combine policy values and game rules; they do not imply feelings or consciousness.
            Speech uses event-triggered templates.
          </p>
        </>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button
            className="text-button"
            onClick={() => setRetry((v) => v + 1)}
          >
            Retry details
          </button>
        </div>
      )}
      <button className="secondary full" onClick={() => onFocus(c)}>
        <Icon name="center" size={18} />
        Find in the world
      </button>
    </>
  );
}
function Chart({
  history,
  metric,
  label,
}: {
  history: HistoryPoint[];
  metric: "pop" | "food";
  label: string;
}) {
  if (!history.length)
    return (
      <p className="muted small">
        The first history sample arrives at tick 30.
      </p>
    );
  const points = history.slice(-100);
  const max = Math.max(1, ...points.map((p) => p[metric]));
  const min = 0;
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${(i / Math.max(1, points.length - 1)) * 280 + 6},${84 - ((p[metric] - min) / (max - min)) * 68}`,
    )
    .join(" ");
  return (
    <div className="chart">
      <div className="chart-title">
        <span>{label}</span>
        <strong>{number(points.at(-1)?.[metric], 1)}</strong>
      </div>
      <svg
        viewBox="0 0 292 100"
        role="img"
        aria-label={`${label} over ${points[0].tick} to ${points.at(-1)!.tick} ticks. Latest ${points.at(-1)![metric]}, maximum ${number(max, 1)}.`}
      >
        <path
          d="M6 84H286M6 50H286M6 16H286"
          stroke="#dde1d1"
          strokeWidth="1"
        />
        <path
          d={`${path} L286,84 L6,84 Z`}
          fill={metric === "pop" ? "#d6e6cf" : "#e6dfb8"}
        />
        <path
          d={path}
          fill="none"
          stroke={metric === "pop" ? "#416648" : "#8b7439"}
          strokeWidth="2"
        />
      </svg>
      <div className="chart-range">
        <span>Tick {number(points[0].tick)}</span>
        <span>{number(points.at(-1)?.tick)}</span>
      </div>
    </div>
  );
}
export function Chronicle({ state }: { state: WorldState }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState<EventPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const generation = useRef(0);
  const previousSeq = useRef(state.seq);
  const previousEpoch = useRef(state.serverEpoch);
  useEffect(() => {
    // A committed-snapshot rollback can rewind the same world's sequence.
    if (state.serverEpoch !== previousEpoch.current || state.seq < previousSeq.current) {
      generation.current++;
      setPage(null); setCursor(0); setError(""); setBusy(false);
    }
    previousSeq.current = state.seq;
    previousEpoch.current = state.serverEpoch;
  }, [state.seq, state.serverEpoch]);
  useEffect(() => () => { generation.current++; }, []);
  async function load(after: number) {
    const current = ++generation.current;
    setBusy(true); setError(""); setCursor(after);
    try {
      const result = await connection.eventPage(after, 100);
      if (current !== generation.current) return;
      if (result.epoch !== state.serverEpoch || result.latestSeq < after) throw new Error("The saved timeline changed. Start saved history again.");
      setPage(result); setCursor(after);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const events = (page ? page.events : [...state.events].reverse())
    .filter(
      (e) =>
        filter === "all" ||
        (filter === "life" &&
          [
            "birth",
            "death",
            "pregnancy",
            "bond",
            "extinction",
            "miscarriage",
          ].includes(e.type)) ||
        (filter === "world" &&
          !["birth", "death", "pregnancy", "bond", "miscarriage"].includes(
            e.type,
          )),
    );
  function exportHistory() {
    const csv =
      "tick,population,food,wood,stone,shelters,births,deaths\n" +
      state.history
        .map((h) =>
          [
            h.tick,
            h.pop,
            h.food,
            h.wood,
            h.stone,
            h.shelters,
            h.births,
            h.deaths,
          ].join(","),
        )
        .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "stratoks-history.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <>
      {state.history.length ? <>
        <Chart history={state.history} metric="pop" label="Population" />
        <Chart history={state.history} metric="food" label="Available food" />
      </> : <p className="muted small">Population and resource history starts at tick 30.</p>}
      <button
        className="secondary full"
        onClick={exportHistory}
        disabled={!state.history.length}
      >
        <Icon name="download" size={16} />
        Download history
      </button>
      <h3 className="section-heading">The world’s chronicle</h3>
      {state.mode !== "demo" && (
        <>
          <button className="secondary full" disabled={busy} onClick={() => load(0)}>
            {busy ? "Loading saved events…" : page ? "Start saved history again" : "Browse saved events"}
          </button>
          {page && (
            <>
              <p className="small muted" role="status">
                {page.events.length ? `Saved events #${page.events[0].seq}–#${page.events.at(-1)!.seq}, oldest first.` : "No saved events after this cursor."}
              </p>
              {page.gap && <p className="notice">Older events were removed by log rotation. The first available event is #{page.gap.oldestAvailableSeq}. Lifecycle records are kept separately.</p>}
              <button className="secondary full" disabled={busy || !page.hasMore} onClick={() => load(page.nextAfter)}>Next saved page</button>
            </>
          )}
          {(page || error) && <button className="text-button" onClick={() => {
            generation.current++; setPage(null); setCursor(0); setBusy(false); setError("");
          }}>Show recent events</button>}
          {error && <div className="error" role="alert">{error}<button className="text-button" disabled={busy} onClick={() => load(cursor)}>Retry saved page</button></div>}
        </>
      )}
      <div className="segment" aria-label="Filter events">
        {[
          ["all", "All events"],
          ["life", "Life"],
          ["world", "Settlement"],
        ].map(([v, l]) => (
          <button
            key={v}
            aria-pressed={filter === v}
            onClick={() => setFilter(v)}
          >
            {l}
          </button>
        ))}
      </div>
      <ol className="story-list">
        {events.map((e) => (
          <li key={e.seq} data-event-seq={e.seq}>
            <span className={`story-dot ${e.type === "death" ? "loss" : ""}`} />
            <p>{eventText(e)}</p>
            <span className="small muted">
              Tick {number(e.tick)} · #{e.seq}
            </span>
          </li>
        ))}
      </ol>
      {!events.length && <p className="muted">No events in this view yet.</p>}
      <p className="fineprint">
        {page ? "One saved page of up to 100 events. " : `Latest ${state.events.length} received events. `}
        The server preserves lifecycle records separately.
      </p>
    </>
  );
}
export function HealthPanel({ state }: { state: WorldState }) {
  const h = state.health,
    w = state.world;
  return (
    <>
      <div className={`health-state ${h?.overloaded ? "warning" : ""}`}>
        <Icon name="signal" size={24} />
        <div>
          <strong>
            {!["connected", "demo"].includes(state.mode)
              ? "Last known world state"
              : h?.overloaded
                ? "World is under load"
                : "World is running"}
          </strong>
          <p className="small">
            {state.mode === "demo"
              ? "Private simulation in this tab"
              : `${h?.clients ?? 0} connected viewers`}
          </p>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Population</dt>
          <dd>{number(w?.population)}</dd>
        </div>
        <div>
          <dt>Births / deaths</dt>
          <dd>
            {number(w?.births)} / {number(w?.deaths)}
          </dd>
        </div>
        <div>
          <dt>Complete shelters</dt>
          <dd>
            {number(w?.sheltersComplete)} / {number(w?.shelters)}
          </dd>
        </div>
        <div>
          <dt>Food units</dt>
          <dd>{number(w?.food, 1)}</dd>
        </div>
        <div>
          <dt>Pair bonds</dt>
          <dd>{number(w?.pairs)}</dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd>{w?.learning ? "Enabled" : "Disabled"}</dd>
        </div>
        <div>
          <dt>
            {state.mode === "demo" ? "Last tick time" : "Tick latency · p95"}
          </dt>
          <dd>{number(h?.tickLatencyMs.p95, 2)} ms</dd>
        </div>
        <div>
          <dt>Tick budget</dt>
          <dd>{number(h?.tickLatencyMs.budget)} ms</dd>
        </div>
        <div>
          <dt>Server CPU</dt>
          <dd>
            {h?.cpuPercent == null
              ? "Not measured"
              : `${number(h.cpuPercent, 1)}% of one core`}
          </dd>
        </div>
        <div>
          <dt>Server memory</dt>
          <dd>{h?.rssMB == null ? "Not measured" : `${number(h.rssMB)} MB`}</dd>
        </div>
        <div>
          <dt>Lag</dt>
          <dd>{number(h?.lagMs)} ms</dd>
        </div>
      </dl>
      <h3 className="section-heading">Life stages</h3>
      <dl className="facts">
        {Object.entries(w?.stages ?? {}).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="section-heading">Recorded causes of death</h3>
      {Object.keys(w?.deathsByCause ?? {}).length ? (
        <dl className="facts">
          {Object.entries(w!.deathsByCause).map(([k, v]) => (
            <div key={k}>
              <dt>{k.replaceAll("_", " ")}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted small">No deaths recorded in this world.</p>
      )}
      <p className="notice">
        Under load, the shared simulation slows and sends fewer updates.
        Creatures are never removed to save CPU.
      </p>
      <p className="fineprint">
        {state.mode === "demo"
          ? "This demo is private, runs only while this tab is open, and resets on reload. It begins after 900 simulated ticks from the default 24-creature seed."
          : "The authoritative server runs without viewers. After downtime, catch-up is capped and non-lethal by default."}
      </p>
    </>
  );
}
export function ToolsPanel({
  state,
  session,
  selected,
}: {
  state: WorldState;
  session: Session | null;
  selected: Entity | undefined;
}) {
  const demo = state.mode === "demo",
    enabled = demo || session?.role === "developer";
  const [type, setType] = useState<Intervention["type"]>("add_food");
  const [x, setX] = useState(Math.round(selected?.x ?? 28));
  const [y, setY] = useState(Math.round(selected?.y ?? 28));
  const [radius, setRadius] = useState(4);
  const [intensity, setIntensity] = useState(0.5);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const actor = session?.address.toLowerCase() ?? "";
  const pendingKey = makePendingKey(connection.config.httpUrl, state.world?.worldId ?? "", actor);
  const oldKey = legacyPendingKey(connection.config.httpUrl, state.world?.worldId ?? "");
  const [legacy, setLegacy] = useState<Intervention | null>(() => {
    try { return demo ? null : parsePending(sessionStorage.getItem(oldKey)); }
    catch { return null; }
  });
  const [pending, setPending] = useState<Intervention | null>(() => {
    if (demo) return null;
    try {
      return actor ? parsePending(sessionStorage.getItem(pendingKey)) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!pending) return;
    setType(pending.type);
    setX(pending.x);
    setY(pending.y);
    setRadius(pending.radius);
    setIntensity(pending.intensity);
  }, [pending]);
  function rememberPending(body: Intervention | null) {
    setPending(body);
    if (!demo)
      try {
        if (body) sessionStorage.setItem(pendingKey, JSON.stringify(body));
        else sessionStorage.removeItem(pendingKey);
      } catch {
        /* In-memory retry remains available when browser storage is disabled. */
      }
  }
  const destructive = type === "fire" || type === "storm";
  async function apply(body: Intervention) {
    if (!demo && (!actor || connection.session?.address.toLowerCase() !== actor)) {
      setError("Sign in with the wallet that owns this request before retrying.");
      return;
    }
    rememberPending(body);
    setBusy(true);
    setError("");
    setResult("");
    try {
      const r = await connection.intervene(body);
      setResult(
        `${r.duplicate ? "Already applied; no duplicate effect" : "Applied"} at tick ${r.record.appliedTick}.`,
      );
      rememberPending(null);
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
      // A retry's 401/403/429 says nothing about the earlier uncertain outcome.
      // Preserve its ownership and ID until a durable acknowledgement or dismissal.
      if (e instanceof ApiError && e.status < 500 && !pending) {
        rememberPending(null);
      } else rememberPending(body);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {demo ? (
        <p className="notice">
          Local test tools. Effects apply only to this private demo.
        </p>
      ) : (
        <p className="muted">
          Only an authenticated developer can change this shared world.
        </p>
      )}
      {!enabled ? (
        <div className="empty-state">
          <Icon name="shield" size={32} />
          <h3>Developer access required</h3>
          <p>
            Connect and sign in with a wallet listed in the server’s developer
            configuration.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (destructive && !confirm) {
              setError(
                "Confirm the damage below before applying this intervention.",
              );
              return;
            }
            apply({ id: crypto.randomUUID(), type, x, y, radius, intensity });
          }}
        >
          {legacy && <div className="notice">
            <p>An older saved request has no recorded wallet. Check the server’s intervention ledger with the original developer before applying another effect.</p>
            <p className="small request-id">Request ID: {legacy.id}</p>
            <p className="small">{legacy.type.replaceAll("_", " ")} at ({legacy.x}, {legacy.y}), radius {legacy.radius}, intensity {Math.round(legacy.intensity * 100)}%.</p>
            <button type="button" className="text-button" onClick={() => {
              try { sessionStorage.removeItem(oldKey); } catch { /* in-memory dismissal */ }
              setLegacy(null);
            }}>Dismiss legacy request after checking</button>
          </div>}
          <fieldset disabled={busy || !!pending || !!legacy}>
            <legend className="sr-only">Intervention</legend>
            <label>
              Intervention
              <select
                aria-label="Intervention"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as Intervention["type"]);
                  setConfirm(false);
                  setError("");
                  setResult("");
                }}
              >
                <option value="add_food">Add food</option>
                <option value="heal_area">Heal an area</option>
                <option value="fire">Start a localized fire</option>
                <option value="storm">Trigger a storm</option>
              </select>
            </label>
            <div className="form-pair">
              <label>
                Tile X
                <input
                  type="number"
                  min="0"
                  max={(state.world?.width ?? 56) - 1}
                  required
                  value={x}
                  onChange={(e) => setX(Number(e.target.value))}
                />
              </label>
              <label>
                Tile Y
                <input
                  type="number"
                  min="0"
                  max={(state.world?.height ?? 56) - 1}
                  required
                  value={y}
                  onChange={(e) => setY(Number(e.target.value))}
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
                }}
              >
                Use selected creature’s location
              </button>
            )}
            <label>
              Radius · {radius} tiles
              <input
                type="range"
                min="1"
                max="8"
                step="1"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </label>
            <label>
              Intensity · {Math.round(intensity * 100)}%
              <input
                type="range"
                min=".1"
                max="1"
                step=".1"
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
              />
            </label>
            {destructive && (
              <label className="checkbox danger-note">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                I understand this damages health, food, and shelters in the
                selected area.
              </label>
            )}
            <button
              type="submit"
              className={`${destructive ? "danger-button" : "primary"} full`}
              disabled={busy}
            >
              {busy
                ? "Applying…"
                : destructive
                  ? "Apply destructive intervention"
                  : "Apply intervention"}
              <Icon
                name={
                  type === "add_food"
                    ? "leaf"
                    : type === "heal_area"
                      ? "heart"
                      : type === "fire"
                        ? "fire"
                        : "storm"
                }
                size={18}
              />
            </button>
          </fieldset>
          {pending && (
            <div className="notice">
              <p>
                The response is uncertain. Retry the same intervention ID to
                prevent a duplicate effect. Use the same signed-in wallet.
              </p>
              <p className="small">
                {pending.type.replaceAll("_", " ")} at ({pending.x}, {pending.y}
                ), radius {pending.radius}, intensity{" "}
                {Math.round(pending.intensity * 100)}%.
              </p>
              <p className="small request-id">Request ID: {pending.id}</p>
              <button
                type="button"
                className="secondary full"
                disabled={busy || !!legacy}
                onClick={() => apply(pending)}
              >
                Retry same intervention
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  rememberPending(null);
                  setError("");
                  setResult(
                    "Uncertain request dismissed. Check the chronicle before applying another effect.",
                  );
                }}
              >
                Dismiss request
              </button>
            </div>
          )}
          <p className="error" role="alert">
            {error}
          </p>
          <p className="success" role="status">
            {result}
          </p>
        </form>
      )}
      <h3 className="section-heading">Room to recover</h3>
      <p className="muted small">
        Default cooldowns: food and healing 30 ticks; fire 300; storms 600. At
        most six of each type per 3,600 ticks. The server enforces its
        configured limits.
      </p>
      <p className="fineprint">
        Each intervention has a unique ID within this world and signed-in wallet.
        Retrying with that wallet applies its effect once. No payments are collected.
      </p>
    </>
  );
}
