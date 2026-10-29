import { lazy, Suspense, useEffect, useState } from 'react';
import ExpanseApp from './expanse/App';
const Settlement = lazy(()=>import('./App'));
export default function Router(){const [hash,setHash]=useState(location.hash);useEffect(()=>{const listener=()=>setHash(location.hash);addEventListener('hashchange',listener);return()=>removeEventListener('hashchange',listener);},[]);return hash==='#settlement'?<><div className="exp-legacy-return"><a href="#">Return to Expanse</a><span>Preserved settlement client & authentication</span></div><Suspense fallback={<p>Loading settlement…</p>}><Settlement/></Suspense></>:<ExpanseApp/>;}
