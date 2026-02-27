import { PolicySimulator } from "@/components/policy-simulator";
import { SiteNav } from "@/components/site-nav";

export default function SimulatorPage() {
  return (
    <main className="page-shell">
      <SiteNav />
      <section className="page-intro">
        <p className="eyebrow">INTERACTIVE DEMO</p>
        <h1>Replay tool calls against TripWire policies and anomaly thresholds.</h1>
        <p>
          This simulator runs fully client-side. Adjust policy blocks and JSONL events, then inspect decisions and
          rationale per event.
        </p>
      </section>

      <PolicySimulator />
    </main>
  );
}
