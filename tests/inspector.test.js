// Minimal DOM scaffold, explicitly NOT a browser rendering/CORS test.
// The inspector module, circuit, HTTP reads and WebSocket transport are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp } from './helpers.js';
class Element {
  constructor(tag = '') { this.tag = tag; this.children = []; this.value = ''; this.textContent = ''; this.checked = false; this.hidden = false; }
  replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
  append(node) { this.children.push(node); if (this.tag === 'select' && !this.value) this.value = String(node.value); }
}
test('static inspector uses real server data, GET-only transport, isolated live circuit and frozen heldout evaluation', async () => {
  const app = await startApp({ world: { brainMode: 'mb-v1', tickMs: 1000 } }, { manualTicks: true });
  const methods = [], intervals = [], sockets = [];
  app.server.on('request', req => methods.push(req.method));
  for (let i = 0; i < 40; i++) app.svc.tickOnce();
  const elements = new Map();
  const native = { document: globalThis.document, location: globalThis.location, setInterval: globalThis.setInterval, WebSocket: globalThis.WebSocket };
  globalThis.document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element(id === 'creature' ? 'select' : ''));
    return elements.get(id);
  }, createElement(tag) { return new Element(tag); } };
  document.getElementById('seed').value = '1';
  globalThis.location = { href: `http://127.0.0.1:8880/?server=${encodeURIComponent(app.base)}` };
  globalThis.setInterval = (...args) => { const timer = native.setInterval(...args); intervals.push(timer); return timer; };
  globalThis.WebSocket = class extends native.WebSocket { constructor(url) { super(url); sockets.push(this); } };
  try {
    await import(`../deploy/phase2a-demo/inspector.js?test=${Date.now()}`);
    assert.match(elements.get('mode').textContent, /mb-v1/);
    const decision = JSON.parse(elements.get('decision').textContent);
    assert.equal(decision.selectedAction, app.svc.world.creatures[0].brain.inspection.selectedAction);
    assert.ok(elements.get('candidates').children.length > 0);
    const serverBefore = JSON.stringify(app.svc.world.toState());
    elements.get('acquire').onclick();
    const acquired = JSON.parse(elements.get('experiment').textContent); assert.ok(acquired.updates > 0);
    elements.get('evaluate').onclick();
    const evaluated = JSON.parse(elements.get('experiment').textContent);
    assert.equal(evaluated.updates, acquired.updates); assert.equal(evaluated.phases.at(-1).weightsChanged, false);
    assert.ok(evaluated.phases.at(-1).fractionCorrect > 0.75);
    elements.get('reverse').onclick(); elements.get('evaluate').onclick();
    assert.ok(JSON.parse(elements.get('experiment').textContent).phases.at(-1).fractionCorrect > 0.75);
    elements.get('lesion').onclick();
    assert.ok(JSON.parse(elements.get('experiment').textContent).phases.at(-1).fractionCorrect < 0.7);
    elements.get('reset').onclick(); elements.get('freeze').checked = true; elements.get('acquire').onclick();
    const frozen = JSON.parse(elements.get('experiment').textContent);
    assert.equal(frozen.updates, 0); assert.equal(frozen.phases.at(-1).weightsChanged, false);
    assert.equal(JSON.stringify(app.svc.world.toState()), serverBefore, 'component controls never touch shared world');
    assert.ok(methods.every(m => m === 'GET'));
    assert.ok(sockets.length > 0);
  } finally {
    for (const timer of intervals) clearInterval(timer);
    await Promise.all(sockets.map(socket => socket.readyState === 3 ? Promise.resolve() : new Promise(resolve => { socket.addEventListener('close', resolve, { once: true }); socket.close(); })));
    Object.assign(globalThis, native); await app.stop();
  }
});
test('static circuit assets match exact server implementation', () => {
  for (const name of ['brain', 'mushroom', 'rng']) assert.deepEqual(fs.readFileSync(new URL(`../deploy/phase2a-demo/circuit/${name}.js`, import.meta.url)), fs.readFileSync(new URL(`../server/src/${name}.js`, import.meta.url)));
});
