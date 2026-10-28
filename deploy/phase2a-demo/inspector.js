import { createMushroom, encode, readout, reinforce, pickMushroom, MB_PARAMS } from './circuit/mushroom.js';
import { Rng } from './circuit/rng.js';
const el = id => document.getElementById(id);
let base = '', socket = null, timer = null, loading = false;
function showDetail(detail) {
  const b = detail.brainBehavior;
  if (!b) { el('mode').textContent = 'Server does not expose brain interface v1'; return; }
  el('mode').textContent = `${b.mode} · updates ${b.updates} · ${b.learningEnabled ? 'plasticity permitted' : 'plasticity disabled'}`;
  const d = b.decision;
  el('decision').textContent = d ? JSON.stringify({ creature: detail.name, tick: d.tick, decisionSource: d.source, selectedAction: d.selectedAction, selectedTarget: d.selectedTarget, activeKCs: d.activeKCs }, null, 2) : 'No decision yet';
  el('details').textContent = JSON.stringify({ sensed: d?.sensed, rewardHistory: b.rewardHistory, note: b.note }, null, 2);
  el('candidates').replaceChildren();
  for (const c of d?.candidates ?? []) {
    const tr = document.createElement('tr');
    for (const value of [`${c.action}${c.target === null ? '' : ` / ${c.target}`}`, c.score.toFixed(3), c.preference === null ? 'legacy' : c.preference.toFixed(3)]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    el('candidates').append(tr);
  }
}
async function refresh() {
  if (loading || !base) return;
  loading = true;
  try {
    const id = el('creature').value;
    if (id) {
      const response = await fetch(`${base}/api/creatures/${id}`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Inspector HTTP ${response.status}`);
      showDetail(await response.json());
    }
  } catch (error) { el('status').textContent = String(error); }
  finally { loading = false; }
}
async function connect() {
  clearInterval(timer); socket?.close();
  try {
    const url = new URL(el('server').value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or loopback HTTP for a local demo.');
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Use a server origin without credentials, path or query.');
    base = url.origin;
    const response = await fetch(`${base}/api/creatures`, { credentials: 'omit' });
    if (!response.ok) throw new Error(`Connection HTTP ${response.status}`);
    const data = await response.json(); el('creature').replaceChildren();
    for (const c of data.creatures) { const option = document.createElement('option'); option.value = c.id; option.textContent = `${c.name} (#${c.id})`; el('creature').append(option); }
    const ws = new URL('/ws', base); ws.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(ws);
    socket.onmessage = message => { const d = JSON.parse(message.data); el('status').textContent = `Server tick ${d.tick} · ${d.type} · read only`; };
    socket.onclose = () => { el('status').textContent = 'WebSocket closed; inspector HTTP reads continue'; };
    socket.onerror = () => { el('status').textContent = 'WebSocket connection error'; };
    await refresh(); timer = setInterval(refresh, 2000);
  } catch (error) { base = ''; el('status').textContent = String(error); }
}
el('connect').onclick = connect; el('creature').onchange = refresh;
let brain, env, goodSite, reversed = false, history = [], step = 0;
const features = [0.4, 0.25, 0, 0.6, 1, 0, 0, 0, 0, 0, 0, 1];
function reset() {
  const seed = Number(el('seed').value);
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 100000) { el('experiment').textContent = 'Seed must be an integer from 1 to 100000'; return; }
  brain = createMushroom(seed); env = new Rng(seed * 917 + 5); goodSite = env.int(2); reversed = false; history = []; step = 0;
  report('Initialized untrained independent circuit.');
}
function report(note) {
  el('experiment').textContent = JSON.stringify({ note, currentlyRewardedSite: (reversed ? 1 - goodSite : goodSite) + 1, updates: brain.updates, phases: history, recentReinforcement: brain.rewardHistory.slice(-4) }, null, 2);
}
function run(name, n, learn, ablated = false, threat = false) {
  let good = 0;
  const weightsBefore = JSON.stringify([brain.positive, brain.negative]);
  for (let i = 0; i < n; i++) {
    const f = features.slice(); if (!learn) f[0] = 0.45;
    const candidates = [24, 32].map((x, site) => {
      const trace = encode(brain, { features: f, x, y: 28, width: 56, height: 56, cues: [1, 0, 0, 0] });
      return { site, trace, u: MB_PARAMS.gain * readout(brain, 'EAT', trace, ablated) };
    });
    const pick = learn && i % 5 === 0 ? candidates[env.int(2)] : pickMushroom(brain, candidates, 0.35);
    const correct = pick.site === (reversed ? 1 - goodSite : goodSite); good += +correct;
    let reward = threat ? (correct ? 0 : -1.5) : (correct ? 1.25 : -0.75);
    if (learn && env.next() < 0.1) reward = -reward;
    reinforce(brain, 'EAT', pick.trace, reward, ++step, learn && !el('freeze').checked);
  }
  history.push({ phase: name, trials: n, fractionCorrect: good / n, weightsChanged: weightsBefore !== JSON.stringify([brain.positive, brain.negative]) });
  if (history.length > 12) history.shift(); report('Measured choices, not precomputed preferences.');
}
el('reset').onclick = reset;
el('acquire').onclick = () => { reversed = false; run('acquisition', 300, true); };
el('reverse').onclick = () => { reversed = !reversed; run('reward reversal', 400, true); };
el('threat').onclick = () => run('punishment-only conditioning', 300, true, false, true);
el('evaluate').onclick = () => run('held-out; no learning', 200, false);
el('lesion').onclick = () => run('held-out; learned output removed', 200, false, true);
reset();
const configured = new URL(location.href).searchParams.get('server');
if (configured) { el('server').value = configured; await connect(); }
else {
  try {
    const response = await fetch('./demo-config.json');
    if (response.ok) {
      const demo = await response.json();
      if (demo.isolated === true) { el('server').value = demo.httpUrl; await connect(); el('world-section').hidden = false; el('world').src = './world/'; }
    }
  } catch { /* Static hosting can omit the optional local demo configuration. */ }
}
