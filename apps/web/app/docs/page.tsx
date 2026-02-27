import { SiteNav } from "@/components/site-nav";
import { DocsBackgroundScene } from "@/components/docs-infographic";
import { DocsLibrary, type DocsAsset } from "@/components/docs-library";

const downloadables: DocsAsset[] = [
  {
    title: "TripWire Skill",
    description: "Chain-of-command handling rules for unsupported-by-policy calls.",
    href: "/downloads/tripwire-skill.md",
    category: "quickstart",
    tags: ["skill", "exceptions", "audit"],
    recommended: true
  },
  {
    title: "TripWire Spec",
    description: "Runtime contract, decision model, policy format, and package exports.",
    href: "/downloads/SPEC.md",
    category: "reference",
    tags: ["runtime", "api contract", "architecture"],
    recommended: true
  },
  {
    title: "Chain Of Command",
    description: "Escalation workflow and one-time exception permit behavior.",
    href: "/downloads/chain-of-command.md",
    category: "policy",
    tags: ["escalation", "reviewer", "permit"]
  },
  {
    title: "Research Matrix",
    description: "Comparable tools and architecture references used for positioning.",
    href: "/downloads/research-matrix.md",
    category: "reference",
    tags: ["landscape", "benchmarking", "strategy"]
  },
  {
    title: "Project README",
    description: "Repository structure, quick start, and CLI examples.",
    href: "/downloads/README.md",
    category: "quickstart",
    tags: ["setup", "cli", "overview"]
  }
];

const skillHighlights = [
  "Use only for unsupported-by-policy tool calls in allowlist posture.",
  "Confirm zero deterministic findings before escalating.",
  "Collect reviewer identity and reason for every yes/no decision.",
  "One-time permits are exact-call and consumed on first use."
];

const quickPath = [
  {
    step: "1",
    title: "Read the runtime contract",
    body: "Start with the spec to understand decision states, findings, and chain-of-command behavior.",
    href: "/downloads/SPEC.md"
  },
  {
    step: "2",
    title: "Load the skill",
    body: "Use the TripWire skill rules to handle unsupported-by-policy calls without bypassing explicit blocks.",
    href: "/downloads/tripwire-skill.md"
  },
  {
    step: "3",
    title: "Adopt the escalation protocol",
    body: "Use the chain-of-command doc when human review is needed for one-time exact-call permits.",
    href: "/downloads/chain-of-command.md"
  }
] as const;

export default function DocsPage() {
  return (
    <>
      <DocsBackgroundScene />

      <main className="page-shell">
        <SiteNav />

        <section className="page-intro docs-intro" id="top">
          <p className="eyebrow">DOCS HUB</p>
          <h1>TripWire docs that are easier to scan, adopt, and operationalize.</h1>
          <p>
            The docs are organized by onboarding flow: understand the runtime path, adopt the skill safely, then pull
            the markdown docs you need for local or agent workflows.
          </p>
          <div className="docs-intro__actions">
            <a href="#quick-path" className="button button-primary">
              Start Quick Path
            </a>
            <a href="#downloads" className="button button-secondary">
              Browse Downloads
            </a>
          </div>
        </section>

        <nav className="docs-jump-nav" aria-label="Documentation sections">
          <a href="#flow">Execution flow</a>
          <a href="#quick-path">Quick path</a>
          <a href="#skill">Skill guidance</a>
          <a href="#downloads">Download library</a>
        </nav>

        <section id="flow" className="docs-flow-grid">
          <article className="docs-flow-card">
            <p className="eyebrow">MODEL OUTPUT</p>
            <h2>Incoming tool calls are parsed and normalized.</h2>
            <p>TripWire receives call context before side effects happen.</p>
          </article>
          <article className="docs-flow-card">
            <p className="eyebrow">TRIPWIRE DECISIONING</p>
            <h2>Deterministic policy plus anomaly scoring decide the path.</h2>
            <p>Decision outcomes: allow, require approval, or block.</p>
          </article>
          <article className="docs-flow-card">
            <p className="eyebrow">DISPATCHER EXECUTION</p>
            <h2>Only approved calls proceed to runtime execution.</h2>
            <p>Blocked or escalated calls never reach unsafe side effects.</p>
          </article>
        </section>

        <section className="docs-path" id="quick-path">
          {quickPath.map((item) => (
            <article key={item.title} className="docs-path-card">
              <span>{item.step}</span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              <a href={item.href} download>
                Download step doc
              </a>
            </article>
          ))}
        </section>

        <section className="docs-grid" id="skill">
          <article className="docs-card docs-card--skill">
            <p className="eyebrow">SKILL</p>
            <h2>TripWire Chain Of Command Skill</h2>
            <p>
              This skill standardizes exception handling for unsupported calls while preserving explicit policy blocks
              and auditability.
            </p>

            <ul className="docs-checklist">
              {skillHighlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>

            <div className="docs-actions">
              <a href="/downloads/tripwire-skill.md" download className="button button-primary">
                Download Skill
              </a>
              <a href="/downloads/tripwire-skill.md" target="_blank" rel="noreferrer" className="button button-secondary">
                Preview Markdown
              </a>
            </div>
          </article>

          <article className="docs-card docs-card--note">
            <p className="eyebrow">DOWNLOADABLE DOCS</p>
            <h2>How To Use This Library</h2>
            <p>Filter by onboarding stage, search by keyword, then download or preview each markdown file.</p>
            <ul className="docs-checklist">
              <li>Start with Quickstart if you are setting up TripWire for the first time.</li>
              <li>Use Policy + Governance docs for approval and escalation operations.</li>
              <li>Use Reference docs when integrating with runtime or adapter surfaces.</li>
            </ul>
          </article>
        </section>

        <section className="docs-card docs-card--full" id="downloads">
          <p className="eyebrow">DOWNLOAD LIBRARY</p>
          <h2>Searchable markdown docs</h2>
          <p>All files are directly downloadable and can be previewed in-browser.</p>
          <DocsLibrary items={downloadables} />
        </section>
      </main>
    </>
  );
}
