/// <reference lib="webworker" />
// The real Expanse engine, isolated in a browser worker. No network, shared writes or scripted discoveries.
import { Expanse } from '../../../server/src/expanse/engine.js';
import { World } from '../../../server/src/world.js';
import { DEFAULTS, deepMerge } from '../../../server/src/config.js';
import { frame } from '../../../server/src/expanse/view.js';
let world: any;
let timer: ReturnType<typeof setInterval>;
function run() { clearInterval(timer); timer = setInterval(() => world?.step(), 250); }
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'start') {
      const seed = data.seed;
      const legacy = World.create(deepMerge(DEFAULTS, { world: { seed, brainMode: 'mb-v1', initialSeedCount: 24 } }));
      // initFrom accepts raw typed terrain, avoiding Node's snapshot base64 encoding in the browser.
      world = new Expanse({ initialCount: 24 }); world.initFrom(seed, structuredClone(legacy));
      run();
    } else if (data.type === 'pause') { if (data.paused) clearInterval(timer); else run(); }
    else if (data.type === 'frame') postMessage({ id: data.id, frame: frame(world, data.query) });
  } catch (e) { postMessage({ id: data.id, error: e instanceof Error ? e.message : String(e) }); }
};
