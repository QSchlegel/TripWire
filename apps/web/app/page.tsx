import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { HeroSceneClient } from "@/components/hero-scene-client";

export default function HomePage() {
  return (
    <>
      <HeroSceneClient />

      <main className="page-shell">
        <SiteNav />

        <section className="hero-section">
          <p className="eyebrow">EDGE + NODE TOOL EXECUTION SECURITY</p>
          <h1>TripWire intercepts suspicious agent tool calls before side effects happen.</h1>
          <p>
            Deterministic policy controls meet behavioral anomaly detection in a pre-tool-call hook built for agentic
            runtimes.
          </p>
          <p>
            Set your agent to full access for full creativity. TripWire catches the hiccups before they become
            incidents.
          </p>
          <p>Join as a maintainer; bots are welcome too ;)</p>

          <div className="hero-actions">
            <Link href="/simulator" className="button button-primary">
              Launch Simulator
            </Link>
            <Link href="/docs" className="button button-secondary">
              Docs + Downloads
            </Link>
            <Link href="/research" className="button button-secondary">
              View Research Matrix
            </Link>
          </div>

          <ul className="hero-metrics">
            <li>
              <strong>Decision Flow</strong>
              <span>allow | require_approval | block</span>
            </li>
            <li>
              <strong>Runtime Targets</strong>
              <span>Edge workers + Node services</span>
            </li>
            <li>
              <strong>Policy Surface</strong>
              <span>Structured Markdown + typed compiler</span>
            </li>
            <li>
              <strong>Operating Model</strong>
              <span>Full access creativity + TripWire safety net</span>
            </li>
          </ul>
        </section>

        <section className="feature-grid">
          <article>
            <h2>ThreatLocker-like policy posture</h2>
            <p>
              Default-deny style controls for high-risk categories with explicit rationale, deterministic matching, and
              audit-ready findings.
            </p>
          </article>

          <article>
            <h2>Hybrid anomaly scoring</h2>
            <p>
              Z-score cadence drift, burst detection, novelty checks, and argument-shape drift provide lightweight
              behavioral defense on the edge.
            </p>
          </article>

          <article>
            <h2>Adapter-ready runtime hooks</h2>
            <p>
              Generic wrappers plus adapters for OpenAI and LangChain keep integration thin while centralizing policy
              and decision logic.
            </p>
          </article>
        </section>
      </main>
    </>
  );
}
