import { Icon } from "../icons";
import { Portrait } from "./art";
import type { Inspector as Detail, Plan, Step, Resident } from "./types";
import { BIOME_NAMES } from "./Map";
const label = (s: string) => s.replaceAll("_", " ");
const num = (n: number | undefined, digits = 2) =>
  n === undefined || !Number.isFinite(n) ? "Unavailable" : n.toFixed(digits);
export function stepName(s: Step): string {
  if (s.prim === "combine")
    return `Combine ${label(s.a ?? "?")} + ${label(s.b ?? "?")}`;
  if (s.prim === "gather") return `Gather ${label(s.kind ?? "resource")}`;
  if (s.prim === "use")
    return s.on === "water"
      ? "Drink water"
      : `Use ${label(s.item ?? "item")} on ${s.on ?? "target"}`;
  if (s.prim === "move") return `Move${s.purpose ? ` · ${s.purpose}` : ""}`;
  return `${s.prim[0].toUpperCase()}${s.prim.slice(1)}${s.item ? ` ${label(s.item)}` : ""}${s.target ? ` · #${s.target}` : ""}`;
}
function PlanEvidence({ plan, current }: { plan: Plan; current: boolean }) {
  return (
    <div className="exp-plan" data-plan-id={plan.id}>
      <div className="exp-evidence-heading">
        <strong>Plan #{plan.id}</strong>
        <span>Tick {plan.tick}</span>
      </div>
      <p className="exp-small exp-muted">
        {plan.source === "reflex"
          ? "Designed reflex"
          : plan.source === "mb-v1"
            ? "mb-v1 · planner disabled"
            : "Planner + mb-v1"}{" "}
        · {plan.alternatives ?? "Unavailable"} candidates
      </p>
      <ol className="exp-plan-steps">
        {plan.steps.map((step, i) => {
          const p = plan.predicted[i],
            a = plan.actual.find((a) => a.step === i);
          return (
            <li
              key={i}
              data-state={a ? (a.success ? "succeeded" : "failed") : "pending"}
            >
              <div className="exp-step-name">
                <span className="exp-step-number">{i + 1}</span>
                <strong>{stepName(step)}</strong>
                <span className="exp-outcome-label">
                  {a
                    ? a.success
                      ? "Succeeded"
                      : "Failed"
                    : current
                      ? "Pending"
                      : "Not executed"}
                </span>
              </div>
              {p ? (
                <>
                  <div className="exp-prediction">
                    <span>
                      Predicted reward <b>{num(p.reward)}</b>
                    </span>
                    <span>
                      Uncertainty <b>{num(p.sigma)}</b>
                    </span>
                  </div>
                  <div className="exp-prediction">
                    <span>
                      Success <b>{num(p.success * 100, 0)}%</b>
                    </span>
                    <span>
                      {p.n === 0
                        ? "Untested prior"
                        : `${num(p.n, 1)} weighted observations`}
                    </span>
                  </div>
                </>
              ) : (
                <p className="exp-small">Prediction unavailable.</p>
              )}
              {a ? (
                <div className="exp-actual">
                  <span>
                    <Icon name={a.success ? "check" : "close"} size={14} />{" "}
                    Actual reward <b>{num(a.reward)}</b>
                  </span>
                  <span>
                    {a.duration} ticks · {num(a.energy, 1)} energy
                  </span>
                  {a.reason && <span>Reason: {label(a.reason)}</span>}
                  {Object.entries(a.produced).length > 0 && (
                    <span>
                      Produced:{" "}
                      {Object.entries(a.produced)
                        .map(([k, v]) => `${v} ${label(k)}`)
                        .join(", ")}
                    </span>
                  )}
                </div>
              ) : (
                <p className="exp-small exp-muted">
                  {current
                    ? "No outcome recorded yet."
                    : "This step has no recorded outcome."}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="exp-score">
        <span>
          mb-v1 preference <b>{num(plan.mbPreference)}</b>
        </span>
        <span>
          Combined utility <b>{num(plan.utility)}</b>
        </span>
      </div>
    </div>
  );
}
function download(detail: Detail) {
  const blob = new Blob([JSON.stringify(detail, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stratoks-creature-${detail.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CreatureInspector({
  detail,
  resident,
  recorded,
  selected,
  pending,
  tick,
  follow,
  onFollow,
  onKnowledge,
  knowledge,
  onDemo,
  connected,
}: {
  detail: Detail | null;
  resident?: Resident;
  recorded: boolean;
  selected: number | null;
  pending: boolean;
  tick?: number;
  follow: boolean;
  onFollow: () => void;
  onKnowledge: () => void;
  knowledge: boolean;
  onDemo: () => void;
  connected: boolean;
}) {
  const observation = detail?.observation;
  return (
    <div
      className="exp-inspector"
      data-creature-id={detail?.id ?? resident?.id}
    >
      <div className="exp-creature-head">
        <div className="exp-portrait">
          <Portrait id={selected ?? 0} size={80} />
        </div>
        <div>
          <h2 tabIndex={-1}>
            {detail?.name ?? resident?.name ?? "Select a resident"}
          </h2>
          <p className="exp-small exp-muted">
            {detail
              ? `#${detail.id} · Age ${detail.age.toLocaleString()} ticks`
              : resident
                ? `Resident #${resident.id}`
                : "Find a resident on the map"}
          </p>
          <p className="exp-small">
            {detail
              ? `${detail.x}, ${detail.y}`
              : resident
                ? `${resident.x}, ${resident.y}`
                : ""}
            {resident?.action ? ` · ${label(resident.action)}` : ""}
          </p>
        </div>
      </div>
      {recorded && (
        <p className="exp-evidence-notice">
          <Icon name="history" size={14} />
          Recorded at tick {tick?.toLocaleString()}
        </p>
      )}
      {resident && (
        <div className="exp-inspector-actions">
          <button
            className={`exp-button ${follow ? "is-active" : "primary"}`}
            aria-pressed={follow}
            onClick={onFollow}
          >
            <Icon name="center" size={16} />
            {follow ? "Following resident" : "Follow resident"}
          </button>
          {detail && (
            <button
              className="exp-icon"
              aria-label="Download actual resident evidence"
              onClick={() => download(detail)}
            >
              <Icon name="download" size={18} />
            </button>
          )}
        </div>
      )}
      {!detail ? (
        <div className="exp-empty">
          <h3>
            {pending
              ? "Loading recorded evidence…"
              : recorded
                ? "Inspector not in this capture"
                : "Resident evidence unavailable"}
          </h3>
          <p>
            {pending
              ? "Waiting for the server’s observation and plan."
              : recorded
                ? "This frozen frame includes the roster, but no detailed inspector for this resident. Connect live or open the private demo to inspect decisions."
                : "The server did not return this resident. Choose another living resident or reconnect."}
          </p>
          {!connected && (
            <button className="exp-button" onClick={onDemo}>
              Explore isolated demo
            </button>
          )}
          {resident && (
            <p className="exp-small exp-muted">
              Health: {resident.health} / 100. Position and action are from the{" "}
              {recorded ? "recorded" : "last received"} roster.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="exp-needs">
            {Object.entries(detail.needs)
              .filter(([k]) => k !== "injury")
              .map(([key, value]) => (
                <label key={key}>
                  <span>
                    {label(key)} <b>{value}</b>
                  </span>
                  <meter
                    min="0"
                    max="100"
                    low={25}
                    high={75}
                    optimum={key === "hunger" || key === "thirst" ? 0 : 100}
                    value={value}
                    aria-label={`${key} ${value} out of 100`}
                  />
                </label>
              ))}
          </div>
          {detail.needs.injury > 0 && (
            <p className="exp-evidence-notice">
              Recorded injury: {detail.needs.injury}
            </p>
          )}
          <details className="exp-science exp-details" open>
            <summary>
              <Icon name="leaf" size={17} />
              Plans<span>Predictions & outcomes</span>
            </summary>
            <div className="exp-science-body">
              <p className="exp-small exp-muted">
                Predictions precede actions. Pending steps have no measured
                result.
              </p>
              {detail.currentPlan ? (
                <PlanEvidence plan={detail.currentPlan} current />
              ) : (
                <p className="exp-empty-note">
                  Between plans. The next decision has not been recorded.
                </p>
              )}
              {detail.recentPlans.length > 0 && (
                <details className="exp-details">
                  <summary>
                    Recent outcomes · {detail.recentPlans.length} retained
                  </summary>
                  {detail.recentPlans
                    .slice()
                    .reverse()
                    .map((p) => (
                      <PlanEvidence key={p.id} plan={p} current={false} />
                    ))}
                </details>
              )}
            </div>
          </details>
          <details className="exp-science exp-details">
            <summary>
              <Icon name="eye" size={17} />
              Perception<span>Last decision</span>
            </summary>
            <div className="exp-science-body">
              {observation ? (
                <>
                  <p className="exp-small exp-muted">
                    Tick {observation.tick} ·{" "}
                    {Math.max(0, (tick ?? observation.tick) - observation.tick)}{" "}
                    ticks ago · v{observation.version}
                  </p>
                  <dl className="exp-observation-grid">
                    <div>
                      <dt>Perception radius</dt>
                      <dd>{observation.radius} tiles</dd>
                    </div>
                    <div>
                      <dt>Effective temperature</dt>
                      <dd>{observation.self.temp} °C</dd>
                    </div>
                    <div>
                      <dt>Biome</dt>
                      <dd>
                        {BIOME_NAMES[observation.ambient.biome] ??
                          observation.ambient.biome}
                      </dd>
                    </div>
                    <div>
                      <dt>Weather</dt>
                      <dd>{observation.ambient.rain ? "Rain" : "Dry"}</dd>
                    </div>
                    <div>
                      <dt>Nearby creatures recorded</dt>
                      <dd>{observation.creatures.length}</dd>
                    </div>
                  </dl>
                  <button
                    className="exp-button"
                    aria-pressed={knowledge}
                    onClick={onKnowledge}
                  >
                    <Icon name="eye" size={16} />
                    {knowledge
                      ? "Hide perception range"
                      : "Show perception range"}
                  </button>
                  <p className="exp-small exp-muted">
                    The range is from the last decision at {observation.self.x},{" "}
                    {observation.self.y}. The observer map shows more than this
                    creature knows.
                  </p>
                  <h3>Recorded nodes · {observation.nodes.length} / 24</h3>
                  {observation.nodes.length ? (
                    <ul className="exp-data-list">
                      {observation.nodes.map((n) => (
                        <li key={n.id}>
                          <span>
                            {label(n.kind)} · {n.x}, {n.y}
                          </span>
                          <b>{n.units} units</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="exp-small">No resource nodes recorded.</p>
                  )}
                  <h3>Water in perception</h3>
                  <p className="exp-small">
                    Fresh:{" "}
                    {observation.water
                      ? `${observation.water.x}, ${observation.water.y}`
                      : "none recorded"}
                    <br />
                    Salt:{" "}
                    {observation.saltWater
                      ? `${observation.saltWater.x}, ${observation.saltWater.y}`
                      : "none recorded"}
                  </p>
                </>
              ) : (
                <p className="exp-empty-note">
                  No observation is available yet. After a restart, observations
                  resume at the next decision.
                </p>
              )}
            </div>
          </details>
          <details className="exp-science exp-details">
            <summary>
              <Icon name="spark" size={17} />
              Learning<span>Retained evidence</span>
            </summary>
            <div className="exp-science-body">
              <dl className="exp-observation-grid">
                <div>
                  <dt>Outcome model entries</dt>
                  <dd>{detail.modelEntries} / 96</dd>
                </div>
                <div>
                  <dt>mb-v1 updates</dt>
                  <dd>{detail.mbUpdates}</dd>
                </div>
                <div>
                  <dt>Known resource nodes</dt>
                  <dd>{detail.knownNodes} / 40</dd>
                </div>
                <div>
                  <dt>Freshwater memories</dt>
                  <dd>{detail.knownWater.length} / 6</dd>
                </div>
              </dl>
              <p className="exp-small exp-muted">
                Mode: {detail.mode} · Learning{" "}
                {detail.learning ? "active" : "frozen"}. Socially observed
                transitions carry fractional evidence; memory is never copied
                whole.
              </p>
              <h3>Inventory</h3>
              {Object.values(detail.inventory).some((v) => v > 0) ? (
                <ul className="exp-data-list">
                  {Object.entries(detail.inventory)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => (
                      <li key={k}>
                        <span>{label(k)}</span>
                        <b>{n}</b>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="exp-small exp-muted">Nothing carried.</p>
              )}
              <h3>Recorded discoveries</h3>
              {detail.discoveries.length ? (
                <ul className="exp-discovery-names">
                  {detail.discoveries.map((d) => (
                    <li key={d}>{label(d)}</li>
                  ))}
                </ul>
              ) : (
                <p className="exp-small exp-muted">
                  No successful combinations or fire ignition recorded.
                </p>
              )}
              <details className="exp-details">
                <summary>Episodes · {detail.episodes.length} shown</summary>
                <ul className="exp-episodes">
                  {detail.episodes
                    .slice()
                    .reverse()
                    .map((e, i) => (
                      <li key={i}>
                        <b>
                          Tick {e.tick} · {e.success ? "Succeeded" : "Failed"}
                        </b>
                        <span>{label(e.key)}</span>
                        <span>
                          Reward {num(e.reward)} · {e.duration} ticks
                          {e.reason ? ` · ${label(e.reason)}` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </details>
              <details className="exp-details">
                <summary>Social evidence</summary>
                <p className="exp-small">
                  Following:{" "}
                  {detail.following ? `#${detail.following.id}` : "nobody"}.
                  These opinions belong to this creature.
                </p>
                <ul className="exp-data-list">
                  {Object.entries(detail.reputation).map(([id, n]) => (
                    <li key={id}>
                      <span>Reputation of #{id}</span>
                      <b>{num(n)}</b>
                    </li>
                  ))}
                </ul>
                {Object.keys(detail.reputation).length === 0 && (
                  <p className="exp-small exp-muted">
                    No reputation entries recorded.
                  </p>
                )}
              </details>
            </div>
          </details>
          <details className="exp-details exp-raw">
            <summary>Evidence limits & download</summary>
            <p className="exp-small">
              Eight recent plans and twelve retained episodes are exposed. This
              is a bounded learned outcome model, not a complete fly brain or
              human intelligence. No generated speech or LLM is used.
            </p>
            <button className="exp-button" onClick={() => download(detail)}>
              Download inspector JSON
            </button>
          </details>
        </>
      )}
    </div>
  );
}
