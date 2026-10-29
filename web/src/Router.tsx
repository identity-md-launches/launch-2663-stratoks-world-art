import { lazy, Suspense, useEffect, useState } from "react";
import ExpanseApp from "./expanse/App";
const Settlement = lazy(() => import("./Legacy"));
export default function Router() {
  const [hash, setHash] = useState(location.hash);
  const [legacyAvailable, setLegacyAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const listener = () => setHash(location.hash);
    addEventListener("hashchange", listener);
    return () => removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    let closed = false;
    fetch("./expanse-config.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((c) => {
        if (!closed) setLegacyAvailable(c.legacyAvailable === true);
      })
      .catch(() => {
        if (!closed) setLegacyAvailable(false);
      });
    return () => {
      closed = true;
    };
  }, []);
  if (hash !== "#settlement") return <ExpanseApp />;
  if (legacyAvailable === null) return <p>Checking settlement availability…</p>;
  if (!legacyAvailable)
    return (
      <main className="fatal">
        <h1>The settlement is now part of the Expanse</h1>
        <p>
          The shared world continues in the expanded map. The previous engine is
          archived for recovery.
        </p>
        <a href="#">Return to the live world</a>
      </main>
    );
  return (
    <>
      <div className="exp-legacy-return">
        <a href="#">Return to Expanse</a>
        <span>Preserved settlement client & authentication</span>
      </div>
      <Suspense fallback={<p>Loading settlement…</p>}>
        <Settlement />
      </Suspense>
    </>
  );
}
