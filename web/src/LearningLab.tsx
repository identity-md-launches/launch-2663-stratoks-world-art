import { useEffect, useRef, useState } from "react";
import type { LabCommand, LabReport, LabTask } from "./learningLab";
import { Icon } from "./icons";

const labels: Record<string, string> = { legacy: "Legacy linear", "mb-v1": "Circuit · learning", "mb-v1-frozen": "Circuit · frozen" };
export function LearningLab() {
  const worker = useRef<Worker | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [seed, setSeed] = useState("1");
  const [task, setTask] = useState<LabTask>("location");
  const [report, setReport] = useState<LabReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const w = new Worker(new URL("./learning.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = ({ data }) => {
      clearTimeout(watchdog.current); setBusy(false);
      if (data.error) { setError(data.error); setAnnouncement("Experiment stopped. See the error below."); }
      else {
        setReport(data.report); setError("");
        setAnnouncement(data.command === "retention" ? "Retention check complete. Results are below." : data.report.history.length ? `${data.report.history.at(-1).phase} complete. Measured results are below.` : "Untrained circuits ready. Choose a training or evaluation step.");
      }
    };
    w.onerror = () => { clearTimeout(watchdog.current); setBusy(false); setError("The experiment could not run. Restart the lab to try again."); };
    setBusy(true);
    w.postMessage({ command: "reset", seed: 1, task: "location" });
    watchdog.current = setTimeout(() => { w.terminate(); setBusy(false); setError("The experiment timed out. Restart the lab to try again."); }, 20000);
    return () => { clearTimeout(watchdog.current); w.terminate(); worker.current = null; };
  }, [generation]);
  function send(command: LabCommand | "reset") {
    if (busy || !worker.current) return;
    if (command === "reset" && (!Number.isSafeInteger(Number(seed)) || Number(seed) < 1 || Number(seed) > 100000)) {
      setError("Use an integer seed from 1 to 100000."); return;
    }
    setBusy(true); setError(""); setAnnouncement("Running locally…");
    worker.current.postMessage({ command, seed: Number(seed), task });
    watchdog.current = setTimeout(() => { worker.current?.terminate(); setBusy(false); setError("The experiment timed out. Restart the lab to try again."); }, 20000);
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2) + "\n"], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `stratoks-lab-${report!.task}-seed-${report!.seed}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const latest = report?.history.at(-1);
  return <section className="learning-lab" aria-label="Isolated learning scenarios" aria-busy={busy}>
    <p className="notice">Private experiment · no server writes</p>
    <p className="small">Compare three policies on the same synthetic task. These rewards are local test inputs, not events in the shared world.</p>
    <form className="lab-setup" onSubmit={e => { e.preventDefault(); send("reset"); }}>
      <label htmlFor="lab-scenario">Scenario</label>
      <select id="lab-scenario" value={task} onChange={e => setTask(e.target.value as LabTask)} disabled={busy}>
        <option value="location">Food locations</option><option value="cue">Food cues</option><option value="threat">Learned danger</option>
      </select>
      <label htmlFor="lab-seed">Seed</label>
      <input id="lab-seed" name="scenario-seed" type="number" inputMode="numeric" min={1} max={100000} step={1} required value={seed} onChange={e => setSeed(e.target.value)} disabled={busy} />
      <button className="secondary full" type="submit" disabled={busy}>Reset this experiment</button>
    </form>
    <p className="small muted">{report ? `Running ${report.task === "location" ? "food locations" : report.task === "cue" ? "food cues" : "learned danger"} · seed ${report.seed}. ${report.task === "threat" ? "Safe" : "Rewarded"} site: ${report.rewardedSite}.` : "Preparing the local circuit…"}</p>
    <div className="lab-actions">
      <button className="primary full" disabled={busy || !report} onClick={() => send("acquire")}><Icon name="play" size={16} />Train 300 trials</button>
      <button className="secondary full" disabled={busy || !report} onClick={() => send("evaluate")}>Evaluate without learning</button>
      <button className="secondary full" disabled={busy || !report} onClick={() => send("reverse")}>Reverse rewards & train</button>
      <button className="secondary full" disabled={busy || !report} onClick={() => send("ablate")}>Remove learned output & evaluate</button>
    </div>
    <p className="fineprint">Evaluate before and after training, then reverse the rewards. Removing learned output tests its causal effect while retaining weights.</p>
    <p className="small lab-status" role="status">{announcement}</p>
    {error && <div className="error" role="alert"><p>{error}</p><button className="secondary full" onClick={() => { setSeed("1"); setTask("location"); setReport(null); setGeneration(v => v + 1); }}>Restart lab</button></div>}
    {latest ? <section aria-label="Measured scenario results" data-lab-phase={latest.phase}>
      <h3 className="section-heading">{latest.phase}</h3>
      <p className="small muted">{latest.results[0].trials} trials per mode · site {latest.rewardedSite} is {report?.task === "threat" ? "safe" : "rewarded"}</p>
      <p className="fineprint">Bars show autonomous choices of that site. Forced training exposures are excluded.</p>
      <div className="lab-results">{latest.results.map(r => <div className="lab-result" key={r.mode} data-lab-mode={r.mode}>
        <div><strong>{labels[r.mode]}</strong><span>{(r.autonomousFractionGood * 100).toFixed(1)}%</span></div>
        <meter min={0} max={1} value={r.autonomousFractionGood} aria-label={`${labels[r.mode]} autonomous preferred-outcome choices`} />
        <p className="small muted">Mean reward {r.meanReward.toFixed(3)} · {r.weightsChanged ? "weights changed" : "weights unchanged"}</p>
        <p className="small muted">{r.updates} total updates · {r.forcedTrials.length} forced exposures</p>
      </div>)}</div>
      <p className="fineprint">One seed is an illustration, not a general result. Try other seeds; low scores and failed reversals remain visible.</p>
    </section> : <p className="small muted lab-empty">No measured trials yet. Evaluate an untrained baseline or start training.</p>}
    <details className="brain-disclosure">
      <summary>Check serialized retention</summary>
      <p className="small">Round-trip each experiment’s creature, cues and RNG through JSON. Compare 64 uninterrupted choices with restored choices. This checks local learning retention, not server disk durability.</p>
      <button className="secondary full" disabled={busy || !report} onClick={() => send("retention")}>Check restore</button>
      {report?.retention && <ul className="lab-retention">{report.retention.map(r => <li key={r.mode}>{labels[r.mode]}: {r.stateIdentical && r.choicesIdentical ? "identical state and 64 choices" : "retention check failed"}</li>)}</ul>}
    </details>
    <details className="brain-disclosure">
      <summary>Protocol & recent phases</summary>
      <p className="small">Equal innate scores. Training uses 20% forced exposure and 10% noisy rewards. Evaluation uses 200 new choices, a changed hunger input, and no learning. Reversal trains 400 trials. No survival reflexes run in this experiment.</p>
      <p className="small">Food cues use a fire marker with counterbalanced reward: this is cue association, not a fire reflex. Learned danger uses punishment-only outcomes. Frozen mode starts untrained and never changes circuit weights.</p>
      <p className="small">The reduced circuit uses 36 inputs, 128 sparse units and 8 active winners. Spatial bins and actions are engineered game abstractions, not fly capabilities.</p>
      {report?.history.length ? <ol className="lab-history">{report.history.map((p, i) => <li key={i}>{p.phase} · site {p.rewardedSite}<span className="small muted">{p.results.map(r => `${labels[r.mode]} ${(r.autonomousFractionGood * 100).toFixed(1)}%`).join("; ")}</span></li>)}</ol> : null}
      <p className="fineprint">Only the last 12 phases are kept. Closing this panel discards the experiment. Download results to keep them.</p>
    </details>
    <button className="secondary full" disabled={!report || busy} onClick={download}><Icon name="download" size={16} />Download measured results</button>
  </section>;
}
