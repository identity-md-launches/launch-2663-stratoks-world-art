import { useEffect, useRef, useState } from 'react';
import { Icon, Mascot } from '../icons';
import { Modal } from '../Modal';
import { CreatureInspector } from './Inspector';
import { BIOME_NAMES, clampCamera, MiniMap, WorldMap } from './Map';
import { ExpanseClient, validateServer } from './transport';
import type { Camera, Source, WorldFrame } from './types';
import './expanse.css';
const STORAGE='stratoks-expanse-server-v1';
function initialSource(): Source | null {
  const q=new URLSearchParams(location.search);
  if(q.get('demo')==='1') return {kind:'demo',seed:20260101};
  try { const url=q.get('server')??localStorage.getItem(STORAGE); return url?{kind:'server',url:validateServer(url)}:null; } catch { return null; }
}
export default function ExpanseApp() {
  const [source,setSource]=useState<Source|null>(initialSource);
  const [frame,setFrame]=useState<WorldFrame|null>(null);
  const [camera,setCamera]=useState<Camera>({x:0,y:0,span:56});
  const [queryCamera,setQueryCamera]=useState(camera);
  const [mapAspect,setMapAspect]=useState(1.5);
  const [selected,setSelected]=useState<number|null>(null);
  const [inspectorPending,setInspectorPending]=useState(false);
  const [following,setFollowing]=useState(false);
  const [knowledge,setKnowledge]=useState(false);
  const [borders,setBorders]=useState(false);
  const [paused,setPaused]=useState(false);
  const [error,setError]=useState('');
  const [status,setStatus]=useState<'idle'|'connecting'|'connected'|'stale'>('idle');
  const [modal,setModal]=useState<'settings'|'help'|null>(null);
  const [section,setSection]=useState<'residents'|'discoveries'|'social'>('residents');
  const [search,setSearch]=useState('');
  const [retry,setRetry]=useState(0);
  const [lastRead,setLastRead]=useState<number|null>(null);
  const client=useRef<ExpanseClient|null>(null);
  const firstConfig=useRef(true);
  useEffect(()=>{if(source||!firstConfig.current)return;firstConfig.current=false;let closed=false;fetch('./expanse-config.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(c=>{if(!closed&&c?.httpUrl)try{setSource({kind:'server',url:validateServer(c.httpUrl)});}catch{setError('The configured server URL is invalid. Open Connect server to correct it.');}}).catch(()=>{});return()=>{closed=true;};},[]);
  useEffect(()=>{const timer=setTimeout(()=>setQueryCamera(camera),120);return()=>clearTimeout(timer);},[camera]);
  useEffect(()=>{
    if(!source){client.current=null;return;}
    const c=new ExpanseClient(source.kind==='server'?source.url:undefined,source.kind==='demo'?source.seed:undefined);client.current=c;
    return()=>{c.close();if(client.current===c)client.current=null;};
  },[source]);
  useEffect(()=>{
    if(!source||!client.current)return;
    let closed=false;let timer:ReturnType<typeof setTimeout>;let controller:AbortController;
    const c=client.current;
    async function read(){
      controller=new AbortController();
      try{
        const f=await c!.read({x:Math.floor(queryCamera.x),y:Math.floor(queryCamera.y),w:Math.ceil(queryCamera.span),h:Math.min(96,Math.ceil(queryCamera.span/mapAspect)+1),...(selected!==null?{creature:selected}:{})},controller.signal);
        if(closed)return;
        setFrame(f);setInspectorPending(false);setStatus('connected');setError('');setLastRead(Date.now());
      }catch(e){if(closed)return;setStatus('stale');setError(e instanceof Error&&e.message.includes('compatible')?e.message:'Unable to read this world. Check the server URL, HTTPS and allowed origin, then retry.');}
      if(!closed)timer=setTimeout(read,source!.kind==='demo'?500:1000);
    }
    read();return()=>{closed=true;clearTimeout(timer);controller?.abort();};
  },[source,queryCamera,selected,retry,mapAspect]);
  useEffect(()=>{if(!following||!frame||selected===null)return;const c=frame.residents.find(c=>c.id===selected);if(!c){setFollowing(false);return;}setCamera(old=>{const next=clampCamera({...old,x:c.x-old.span/2,y:c.y-old.span/mapAspect/2},frame.bounds,mapAspect);return Math.abs(old.x-next.x)>.1||Math.abs(old.y-next.y)>.1?next:old;});},[frame,following,selected,mapAspect]);
  const choose=(s:Source|null)=>{setFrame(null);setSelected(null);setFollowing(false);setKnowledge(false);setPaused(false);setSource(s);setCamera({x:0,y:0,span:56});setError('');setLastRead(null);setStatus(s?'connecting':'idle');};
  const demo=()=>choose({kind:'demo',seed:20260101});
  const move=(c:Camera)=>{setFollowing(false);setCamera(clampCamera(c,frame?.bounds,mapAspect));};
  const select=(id:number)=>{setSelected(id);setInspectorPending(true);setKnowledge(false);requestAnimationFrame(()=>{document.querySelector(".exp-inspector-panel")?.scrollIntoView({block:innerWidth<=850?"start":"nearest"});document.querySelector<HTMLElement>(".exp-panel-title h2")?.focus({preventScroll:true});});};
  const focus=(id:number)=>{select(id);const c=frame?.residents.find(c=>c.id===id);if(c){setCamera(clampCamera({...camera,x:c.x-camera.span/2,y:c.y-camera.span/mapAspect/2},frame!.bounds,mapAspect));setFollowing(true);}};
  const residents=frame?.residents.filter(c=>`${c.name} ${c.id}`.toLowerCase().includes(search.toLowerCase()))??[];
  const detail=frame?.inspector?.id===selected?frame.inspector:null;
  return <div className="exp-app" data-tick={frame?.tick} data-source={source?.kind??'preview'} data-connection={status}>
    <a className="skip-link" href="#exp-world">Skip to world</a>
    <header className="exp-header"><a className="exp-brand" href="#"><Mascot size={42}/><span>Stratoks<span>A little world, unfolding</span></span></a><nav className="exp-main-nav" aria-label="World views"><a href="#" aria-current="page"><Icon name="world" size={18}/> Expanse</a><a href="#settlement"><Icon name="home" size={18}/> Settlement</a></nav><div className="exp-header-actions"><button className="exp-icon" aria-label="How this world works" onClick={()=>setModal('help')}><Icon name="help"/></button><button className="exp-button exp-connect" onClick={()=>setModal('settings')}><Icon name="settings" size={17}/><span>{source?.kind==='server'?'Server settings':'Connect server'}</span></button></div></header>
    <main id="exp-world">
      <div className="exp-title-row"><div><h1>Beyond the clearing</h1><p>Explore a world of learning creatures.</p></div><div className="exp-source"><span className={`exp-status-dot ${status==='connected'?'active':''}`}/><span>{status==='stale'?'Connection interrupted':source?.kind==='demo'?(paused?'Isolated demo · paused':'Isolated demo'):status==='connecting'?'Connecting':source?'Shared world':'Terrain preview'}</span>{source&&<button className="exp-text-button" onClick={()=>{choose(null);try{localStorage.removeItem(STORAGE);}catch{}}}>{source.kind==='demo'?'Exit demo':'Disconnect'}</button>}</div></div>
      {!source&&<div className="exp-start"><div><Icon name="leaf" size={22}/><p>Watch, wander, discover.<span>Connect an owner’s server or try a private world.</span></p></div><button className="primary" onClick={demo}><Icon name="play" size={17}/> Explore demo</button></div>}
      {source?.kind==='demo'&&<div className="exp-demo-notice"><Icon name="shield" size={17}/><p>Private browser world · up to 4 ticks/second · resets on exit.</p><button className="exp-button" onClick={()=>{client.current?.pause(!paused);setPaused(!paused);}}><Icon name={paused?'play':'pause'} size={16}/>{paused?'Resume':'Pause'}</button></div>}
      <div className="exp-error" role="status">{error&&<><Icon name="signal" size={18}/><span>{error} {frame?'Showing the last received state.':''}</span><button className="exp-button" onClick={()=>setRetry(v=>v+1)}>Retry</button><button className="exp-text-button" onClick={()=>setModal('settings')}>Edit server</button></>}</div>
      <div className="exp-workspace"><section className="exp-map-panel" aria-label="Explore the world"><div className="exp-map-top"><div><Icon name="world" size={18}/><h2>The expanse</h2><span className="exp-small exp-muted">{frame?BIOME_NAMES[frame.view.biome]: 'Original settlement'}</span></div><button className="exp-button exp-grid-button" aria-pressed={borders} onClick={()=>setBorders(!borders)}><Icon name="world" size={16}/>Chunks</button></div>
        <WorldMap frame={frame} camera={camera} onCamera={move} onSelect={select} selected={selected} knowledge={knowledge} borders={borders} onAspect={setMapAspect}/>
        <div className="exp-map-bottom"><span><span className="exp-tick-icon"/> {frame?`Tick ${frame.tick.toLocaleString()}`:'No simulation connected'}</span><span>{frame?`${frame.summary.population} residents · ${frame.summary.shelters} shelters`:'Pan & zoom after connecting'}</span><span className="exp-map-coords">{Math.round(camera.x)}, {Math.round(camera.y)}</span></div>
        <div className="exp-map-guide"><span><Icon name="center" size={15}/> Drag to pan · + / − to zoom</span><span><span className="exp-creature-dot"/> Select a creature to inspect</span></div>
      </section><aside className="exp-inspector-panel" aria-label="Creature inspector"><div className="exp-panel-title"><h2 tabIndex={-1}>Creature inspector</h2><Icon name="eye" size={18}/></div><CreatureInspector key={selected??'empty'} detail={detail} selected={selected} pending={inspectorPending} tick={frame?.tick} follow={following} onFollow={()=>setFollowing(!following)} onKnowledge={()=>setKnowledge(!knowledge)} knowledge={knowledge} onDemo={demo} connected={!!source}/></aside></div>
      <div className="exp-lower"><section className="exp-world-records" aria-label="World records"><div className="exp-records-tabs"><div className="exp-tabs" aria-label="World record views">{([['residents','Residents','people'],['discoveries','Discoveries','spark'],['social','Social','link']] as const).map(([id,name,icon])=><button key={id} aria-pressed={section===id} onClick={()=>setSection(id)}><Icon name={icon} size={17}/>{name}{id==='residents'&&frame&&<span className="exp-count">{frame.residents.length}</span>}</button>)}</div>{frame&&<span className="exp-small exp-muted">Seed {frame.seed}</span>}</div>
        {section==='residents'&&<><div className="exp-list-toolbar"><label className="exp-search"><Icon name="search" size={17}/><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or ID" aria-label="Find a resident"/></label><span className="exp-small exp-muted">{frame?`${frame.summary.births} births · ${frame.summary.deaths} deaths`:'All lives belong to the server'}</span></div>{residents.length?<div className="exp-residents">{residents.map(c=><button key={c.id} className="exp-resident" aria-pressed={selected===c.id} onClick={()=>focus(c.id)}><Mascot size={36}/><span><strong>{c.name}</strong><span>#{c.id} · {c.action??'Between actions'}</span></span><span className="exp-resident-coords">{c.x}, {c.y}<Icon name="chevron" size={15}/></span></button>)}</div>:<div className="exp-records-empty"><Icon name="people" size={24}/><p>{!source?'Meet the residents of a connected world.':!frame?'Waiting for the first server frame.':search?'No residents match this search.':'No living residents remain in this world.'}</p>{search&&<button className="exp-text-button" onClick={()=>setSearch('')}>Clear search</button>}{!source&&<button className="exp-button" onClick={demo}>Open isolated demo</button>}</div>}</>}
        {section==='discoveries'&&<><p className="exp-section-note exp-small exp-muted">Successful combinations and fire ignition, recorded by the engine. Latest 200 world records; no scheduled inventions.</p>{frame?.discoveries.length?<ol className="exp-history">{frame.discoveries.slice().reverse().map((d,i)=><li key={`${d.tick}-${d.by}-${i}`}><span className="exp-history-mark"><Icon name={d.what.startsWith('fire')?'fire':'spark'} size={18}/></span><div><strong>{d.what.replaceAll('_',' ').replace('combine:','').replace('fire:','Fire · ')}</strong><p>Creature #{d.by} · {d.selfFound?'Self found':'After seeing it done'}{d.firstInWorld?' · First in retained world history':''}</p></div><span>Tick {d.tick}<button className="exp-text-button" disabled={!frame.residents.some(c=>c.id===d.by)} onClick={()=>focus(d.by)}>Inspect #{d.by}</button></span></li>)}</ol>:<div className="exp-records-empty"><Icon name="spark" size={24}/><p>{frame?'No discoveries recorded yet. Success is not guaranteed.':'Connect a world to read its discovery history.'}</p></div>}</>}
        {section==='social'&&<><p className="exp-section-note exp-small exp-muted">Latest 100 social outcomes. Following is voluntary; no creature is assigned to rule.</p>{frame?.social.length?<ol className="exp-history">{frame.social.slice().reverse().map((s,i)=><li key={i}><Icon name="link" size={18}/><div><strong>#{s.actor} · {s.type}{s.target?` → #${s.target}`:''}</strong><p>{typeof s.result==='string'?s.result:JSON.stringify(s.result)}</p></div><span>Tick {s.tick}</span></li>)}</ol>:<div className="exp-records-empty"><Icon name="link" size={24}/><p>No social outcomes are available.</p></div>}</>}
      </section><aside className="exp-atlas" aria-label="World overview"><div className="exp-atlas-heading"><h2>World atlas</h2><span className="exp-small exp-muted">{frame?`${frame.bounds.x1-frame.bounds.x0} × ${frame.bounds.y1-frame.bounds.y0} tiles`:'280 × 280 tiles'}</span></div><div className="exp-atlas-content"><MiniMap frame={frame} camera={camera} onCamera={move} aspect={mapAspect}/><div className="exp-biomes"><span><i style={{background:'#819b69'}}/>Temperate forest</span><span><i style={{background:'#cfb47b'}}/>Arid terrain</span><span><i style={{background:'#becbd0'}}/>Cold highlands</span><span><i style={{background:'#78a5ae'}}/>Coast & islands</span><p>Gray: unmaterialized<br/>Outline: observer viewport</p></div></div></aside></div>
      <footer className="exp-footer"><span>Stratoks · Phase 2B</span><a href="#settlement">Settlement & sign-in</a><span>{frame?`Snapshot tick ${frame.tick} · ${status==='stale'?'stale':source?.kind==='demo'?'local only':'server authoritative'}`:'A window into an autonomous world.'}</span><button className="exp-text-button" onClick={()=>setModal('help')}>What is learned?</button><span className="sr-only">{lastRead?`Last read ${new Date(lastRead).toISOString()}`:''}</span></footer>
    </main>
    {modal==='settings'&&<Modal title="Connect to a world" onClose={()=>setModal(null)}><ServerForm current={source?.kind==='server'?source.url:''} onConnect={url=>{try{localStorage.setItem(STORAGE,url);}catch{}choose({kind:'server',url});setModal(null);}}/><div className="exp-modal-alternative"><h3>Just exploring?</h3><p className="exp-small exp-muted">The demo runs the real engine in this browser. Its creatures and discoveries are private and temporary.</p><button className="exp-button" onClick={()=>{demo();setModal(null);}}>Open isolated demo</button></div><p className="exp-small exp-muted">Settlement sign-in and existing developer tools remain in <a href="#settlement">Settlement</a>. Viewing the Expanse is free and read only.</p></Modal>}
    {modal==='help'&&<Modal title="A world you can observe" onClose={()=>setModal(null)}><div className="exp-help"><p>The server keeps running when you leave. Use the map or Residents to select a creature. Follow it across chunks, then compare its recorded plan with the actual result.</p><h3>What is learned?</h3><p>Each creature learns action outcomes from experience and nearby visible results. Its bounded model records reward, success and costs with uncertainty. The planner compares short sequences alongside mb-v1 preferences.</p><h3>What is designed?</h3><p>Terrain, resources, material recipes, fire, needs, reflexes and planner search are fixed rules. This is an extensible learning model, not a complete fly brain, consciousness or human intelligence.</p><h3>Reading the map</h3><p>Water and cliffs can block creatures. The camera can cross them because it is an observer. Pan with a drag or arrow keys; use + and − to zoom. The dashed boundary marks the preserved 56 × 56 settlement.</p><h3>Evidence has limits</h3><p>Perception is from the last decision, not the current tick. Eight recent plans are retained; unexecuted steps have no actual outcome. The atlas shows materialized chunks, including those viewed by observers. Private demos never write to a server.</p></div></Modal>}
  </div>;
}
function ServerForm({current,onConnect}:{current:string;onConnect:(url:string)=>void}) {const [url,setUrl]=useState(current);const [error,setError]=useState('');const ref=useRef<HTMLInputElement>(null);return <form className="exp-server-form" onSubmit={e=>{e.preventDefault();try{onConnect(validateServer(url));}catch(e){setError((e as Error).message);ref.current?.focus();}}}><p className="exp-small exp-muted">Enter the owner’s Phase 2B server. This client only reads its shared world.</p><label htmlFor="exp-server-url">World server URL</label><input ref={ref} id="exp-server-url" name="server" type="url" placeholder="https://world.example.org" autoComplete="url" required value={url} onChange={e=>setUrl(e.target.value)} aria-invalid={!!error} aria-describedby={error?'exp-server-error':'exp-server-hint'}/><p id="exp-server-hint" className="exp-small exp-muted">HTTPS required. The server must allow this website’s origin. Local HTTP works from a local preview.</p>{error&&<p id="exp-server-error" role="alert" className="exp-field-error">{error}</p>}<button className="primary" type="submit"><Icon name="link" size={18}/> Connect to world</button></form>;}
