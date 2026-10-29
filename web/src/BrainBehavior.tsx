import type { BrainBehavior as Behavior, Detail } from "./types";
import { actionName, number } from "./format";

const features = ["Hunger", "Tiredness", "Hurt", "Food proximity", "Known food", "Homeless", "Carrying material", "Construction available", "Nearby company", "Fire danger", "Storm", "Loneliness"];
const cues = ["Food", "Fire", "Storm", "Gifted food"];
const signed = (n: number | null) => n === null ? "Unavailable" : `${n > 0 ? "+" : ""}${n.toFixed(3)}`;
const sources = { model: "Model choice", reflex: "Survival reflex", rule: "Foraging rule" };

export function BrainBehavior({ detail, local, stale, onLab }: {
  detail: Detail | null; local: boolean; stale: boolean; onLab: () => void;
}) {
  const brain = detail?.brainBehavior;
  if (!detail) return <p className="muted" role="status">Loading brain and behavior…</p>;
  if (!brain || brain.interfaceVersion !== 1) return <div className="notice">
    <h3>Brain details unavailable</h3>
    <p className="small">This server does not expose the supported brain interface. Needs, memories and legacy decisions remain available below.</p>
    <button className="secondary full" onClick={onLab}>Try isolated learning scenarios</button>
  </div>;
  const d = brain.decision;
  return <section className="brain-behavior" aria-label="Brain and behavior" data-brain-mode={brain.mode} data-decision-tick={d?.tick ?? ""} data-selected-action={d?.selectedAction ?? ""}>
    <h3 className="section-heading">Brain / behavior</h3>
    <p className="small muted">{local ? "Private simulation" : "Read-only server"} · <strong>{brain.mode}</strong></p>
    {stale && <p className="notice" role="status">Last received details. The connection is interrupted; this view may be out of date.</p>}
    <p className="small muted">Policy learning {brain.learningEnabled ? "enabled" : "disabled"} · {number(brain.updates)} updates</p>
    {d ? <>
      <div className="brain-selection">
        <span className="small">{sources[d.source] ?? d.source} · tick {number(d.tick)}{d.mode && d.mode !== brain.mode ? ` · ${d.mode}` : ""}</span>
        {!d.mode && <p className="small">Decision mode unrecorded</p>}
        <strong>{actionName(d.selectedAction)}{d.selectedTarget !== null ? ` · food site #${d.selectedTarget}` : ""}</strong>
        <p className="small">{d.source === "model" ? "Sampled from policy scores; the highest score is not always chosen." : "Selected by a survival rule, not evidence of learned preference."}</p>
      </div>
      <p className="fineprint">Last decision, not a new choice each tick. A pending action can predate a mode change.</p>
      <details className="brain-disclosure">
        <summary>Sensed cues</summary>
        <dl className="facts brain-inputs">
          {d.sensed.cues?.map((v, i) => <div key={i}><dt>{cues[i] ?? `Cue ${i}`}</dt><dd>{number(v, 2)}</dd></div>)}
          {d.sensed.x !== undefined && <div><dt>Sensed location</dt><dd>{number(d.sensed.x, 1)}, {number(d.sensed.y, 1)}</dd></div>}
          {d.sensed.visible !== undefined && <div><dt>In perception range</dt><dd>{d.sensed.visible ? "Yes" : "No · remembered site"}</dd></div>}
          {d.sensed.features.slice(0, 12).map((v, i) => <div key={i}><dt>{features[i]}</dt><dd>{number(v, 2)}</dd></div>)}
        </dl>
        <p className="fineprint">Inputs are normalized to 0–1. Out-of-range sites have no live local cues. Location is a coarse game abstraction.</p>
      </details>
      <details className="brain-disclosure" open>
        <summary>Action candidates & preferences</summary>
        <p className="fineprint">{!d.mode ? "Scoring policy and target selection method were not recorded for this decision. Totals and associations are retained as captured." : d.mode === "legacy" ? "Totals use the linear policy and game rules. Circuit associations are unavailable in legacy decisions." : "Action probability uses its best target score, then targets are sampled by score. Association is the circuit output before its 2.5× gain; ablation sets it to zero."} Wallet opinions are separate game memory.</p>
        <CandidateTable brain={brain} />
      </details>
      {(d.mode ? d.mode !== "legacy" : d.activeKCs.length > 0) && <details className="brain-disclosure">
        <summary>Sparse circuit activity</summary>
        <p className="small">{d.activeKCs.length} / 128 KC-like units active for the chosen input.</p>
        <p className="small">Unit indices: {d.activeKCs.join(", ") || "No circuit trace"}.</p>
        <p className="fineprint">Generated wiring, not identified biological neurons. Activity alone does not establish learning.</p>
      </details>}
    </> : <p className="notice">No decision recorded yet. Details refresh automatically.</p>}
    <details className="brain-disclosure">
      <summary>About this mode</summary>
      <p className="small">{brain.mode === "legacy" ? "Legacy linear policy. This mode is not a fly-inspired circuit." : "Reduced mushroom-body-inspired circuit. No full brain emulation or claim of consciousness."}</p>
      {brain.mode === "mb-v1-ablated" && <p className="small">Ablated mode disables circuit updates and removes learned output from scores. Stored weights remain intact.</p>}
      <p className="small">Wallet opinions follow the separate world learning setting, including in frozen and ablated modes.</p>
      <p className="small">Interface v{brain.interfaceVersion} · circuit {brain.circuitVersion ? `v${brain.circuitVersion}` : "not initialized"}. Personality, relationships, wallets and game actions are engineered abstractions.</p>
    </details>
    <details className="brain-disclosure" open>
      <summary>Recent rewards</summary>
      {brain.rewardHistory.length ? <ol className="brain-rewards">{[...brain.rewardHistory].reverse().map((r, i) => <li key={`${r.tick}-${i}`}>
        <div><strong>{actionName(r.action)}</strong><span>{signed(r.reward)}</span></div>
        <p className="small muted">Tick {number(r.tick)} · {r.mode ?? "Earlier mode unrecorded"} · {r.source} · {r.learned ? "Weights updated" : "No weight update"}</p>
        <p className="small muted">Predicted association: {signed(r.prediction)}</p>
      </li>)}</ol> : <p className="small muted">{brain.mode === "legacy" ? "Legacy mode does not record per-action circuit rewards. Its historical mean is shown below." : "No completed action rewards yet."}</p>}
      <p className="fineprint">Up to 16 circuit outcomes, which may predate a mode change. Positive means reward, negative means punishment. An update can follow a forced action.</p>
    </details>
    <button className="secondary full" onClick={onLab}>Try isolated learning scenarios</button>
  </section>;
}

function CandidateTable({ brain }: { brain: Behavior }) {
  const d = brain.decision!;
  return <table className="brain-table">
    <caption className="sr-only">Actual candidates for the last decision</caption>
    <thead><tr><th scope="col">Action / site</th><th scope="col">Total</th><th scope="col">Association</th></tr></thead>
    <tbody>{d.candidates.map((c, i) => <tr key={i} data-chosen={c.action === d.selectedAction && c.target === d.selectedTarget}>
      <th scope="row">{actionName(c.action)}{c.target !== null && <span> #{c.target}</span>}{c.action === d.selectedAction && c.target === d.selectedTarget && <span className="chosen-label">Chosen</span>}</th>
      <td>{signed(c.score)}</td><td>{c.preference === null ? "n/a" : signed(c.preference)}</td>
    </tr>)}</tbody>
  </table>;
}
