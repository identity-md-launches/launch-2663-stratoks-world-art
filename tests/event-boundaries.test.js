// Additional edge cases for the repaired event reader, beyond the inherited suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Store } from '../server/src/store.js';
import { testConfig } from './helpers.js';

test('event pages preserve UTF-8 characters split across 64 KiB reads', async () => {
  const cfg=testConfig({persistence:{eventLogMaxBytes:200_000,eventLogFiles:3}});
  const store=new Store(cfg.server.dataDir,cfg.persistence);store.init();
  try {
    const prefix=JSON.stringify({seq:1,tick:1,type:'filler',pad:''}).slice(0,-2);
    const event={seq:1,tick:1,type:'filler',pad:'x'.repeat(65535-Buffer.byteLength(prefix))+'é'};
    store.appendEvents([event]);
    const [read]=await store.readEvents(0,1);
    assert.ok(read.pad===event.pad,'UTF-8 must survive a chunk boundary without replacement characters');
  } finally {store.release();}
});

test('a pending page pins its retained segment while rotation renames it', async () => {
  const cfg=testConfig({persistence:{eventLogMaxBytes:250,eventLogFiles:3}});
  const store=new Store(cfg.server.dataDir,cfg.persistence);store.init();
  const make=seq=>({seq,tick:seq,type:'filler',pad:'x'.repeat(220)});
  store.appendEvents([make(1)]); // .1
  store.appendEvents([make(2)]); // .2 = 1, .1 = 2
  const original=fsp.open;
  let release;
  const gate=new Promise(r=>{release=r;});
  // Simulate a queued libuv open occurring after the next simulation tick rotates.
  fsp.open=async (...args)=>{await gate;return original(...args);};
  try {
    const pending=store.readEvents(1,1); // event 2 is retained through the next rotation
    store.appendEvents([make(3)]);
    release();
    const result=await pending;
    assert.equal(result[0]?.seq,2,'rotation must not substitute a different segment under an in-flight page');
  } finally {fsp.open=original;store.release();}
});

test('rotation syncs the outgoing log before closing its descriptor', () => {
  const cfg=testConfig({persistence:{eventLogMaxBytes:100,eventLogFiles:3}});
  const store=new Store(cfg.server.dataDir,cfg.persistence);store.init();
  const fd=store.fds['events.jsonl'],sync=fs.fsyncSync,close=fs.closeSync,calls=[];
  fs.fsyncSync=(n)=>{if(n===fd)calls.push('sync');return sync(n);};
  fs.closeSync=(n)=>{if(n===fd)calls.push('close');return close(n);};
  try {
    store.appendEvents([{seq:1,tick:1,type:'filler',pad:'x'.repeat(200)}]);
    assert.equal(calls[0],'sync','the next snapshot can only fsync the new live log; the outgoing generation must already be synced');
    assert.equal(calls[1],'close');
  } finally {fs.fsyncSync=sync;fs.closeSync=close;store.release();}
});
