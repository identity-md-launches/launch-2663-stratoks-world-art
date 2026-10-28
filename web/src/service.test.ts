import assert from "node:assert/strict";
import test from "node:test";
import { WorldConnection, ApiError } from "./service";

test("429 and durability/busy errors expose actionable honest server guidance", async () => {
  const fetchOriginal = globalThis.fetch;
  const c = new WorldConnection();
  c.config = { httpUrl: "https://world.test", wsUrl: "wss://world.test/ws" };
  try {
    globalThis.fetch = async () => Response.json({ error:"rate_limited",retryAfterSec:7 }, {status:429});
    await assert.rejects(c.detail(1), (e: ApiError) => e.status===429 && e.retryAfterSec===7 && /7 seconds/.test(e.message));
    globalThis.fetch = async () => Response.json({error:"event_history_busy"},{status:503});
    await assert.rejects(c.eventPage(0,1), (e: ApiError) => /retry this page/.test(e.message));
    globalThis.fetch = async () => Response.json({error:"not_durable_retry_same_id"},{status:503});
    await assert.rejects(c.request("/api/dev/interventions",{}), (e:ApiError) => /same request with this wallet/.test(e.message));
    globalThis.fetch = async () => Response.json({id:1});
    assert.deepEqual(await c.detail(1),{id:1});
  } finally {globalThis.fetch=fetchOriginal;}
});

test("event cursor is bounded and pagination uses the server cursor unchanged", async () => {
  const original=globalThis.fetch;
  const c=new WorldConnection();c.config={httpUrl:"https://world.test",wsUrl:"wss://world.test/ws"};
  const page={events:[{seq:25,tick:10,type:"birth"}],nextAfter:25,latestSeq:90,hasMore:true,gap:{requestedAfter:0,oldestAvailableSeq:25},source:"log"};
  let url="";
  try{
    globalThis.fetch=async (u)=>{url=String(u);return Response.json(page);};
    assert.deepEqual(await c.eventPage(0,1),page);
    assert.equal(url,"https://world.test/api/events?after=0&limit=1");
    await c.eventPage(page.nextAfter,1);
    assert.match(url,/after=25&limit=1$/);
    for (const [after,limit] of [[-1,1],[0,0],[0,501],[1.5,1],[Number.MAX_SAFE_INTEGER+1,1]])
      assert.throws(()=>c.eventPage(after,limit));
  }finally{globalThis.fetch=original;}
});

test("responses from a stopped connection cannot update a new world", async () => {
  const original=globalThis.fetch;
  const c=new WorldConnection();c.config={httpUrl:"https://world.test",wsUrl:"wss://world.test/ws"};
  let resolve!: (r:Response)=>void;
  try {
    globalThis.fetch=()=>new Promise(r=>{resolve=r;});
    const pending=c.detail(1);
    c.stop();resolve(Response.json({id:1}));
    await assert.rejects(pending,/World connection changed/);
    // A fetch can resolve its headers while the JSON body is still streaming.
    const d=new WorldConnection();d.config=c.config;
    let resolveBody!: (body:unknown)=>void;
    globalThis.fetch=async()=>({ok:true,json:()=>new Promise(r=>{resolveBody=r;})}) as Response;
    const streaming=d.detail(2);
    await new Promise(r=>setTimeout(r,0));
    d.stop();resolveBody({id:2});
    await assert.rejects(streaming,/World connection changed/);
  }finally{globalThis.fetch=original;}
});
