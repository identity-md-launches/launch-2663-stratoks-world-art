// A deterministic terrain-only preview, never shown as a running/shared world.
import fs from 'node:fs';
import { Expanse } from '../../server/src/expanse/engine.js';
import { viewport } from '../../server/src/expanse/view.js';
const e=Expanse.create({}, {seed:20260101});
const view=viewport(e,-3,-3,64,64);view.creatures=[];
fs.writeFileSync(new URL('../src/expanse/preview.json',import.meta.url),JSON.stringify(view));
