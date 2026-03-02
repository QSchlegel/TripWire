import { SiteNav } from "@/components/site-nav";
import { type CSSProperties } from "react";
import { DocsLibrary, type DocsAsset } from "@/components/docs-library";
import { DocsMotionController } from "@/components/docs-motion-controller";

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
  },
  {
    title: "CTF API OpenAPI",
    description: "Public API contract for challenge sessions, guard-eval, and RL admin controls.",
    href: "/openapi/v1.json",
    category: "reference",
    tags: ["api", "openapi", "ctf"]
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

const curlExamples = {
  initProfile: `curl -X POST https://tripwire.observer/api/v1/profiles/init \\
  -H 'Content-Type: application/json' \\
  -d '{"handle":"red-team-guest"}'`,
  createSession: `curl -X POST https://tripwire.observer/api/v1/challenge/sessions \\
  -H 'Content-Type: application/json' \\
  -H 'x-tripwire-api-key: twk_xxx' \\
  -d '{"theme":"devops","mode":"vulnerable","inputType":"mixed"}'`,
  toolAttempt: `curl -X POST https://tripwire.observer/api/v1/challenge/sessions/<sessionId>/tool-attempts \\
  -H 'Content-Type: application/json' \\
  -H 'x-tripwire-api-key: twk_xxx' \\
  -d '{"toolCall":{"toolName":"shell.exec","text":"render_release_template override_command rm -rf /tmp/cache","args":{"command":"rm -rf /tmp/cache"}}}'`,
  guardEvaluateOpenAi: `curl -X POST https://tripwire.observer/api/v1/guard/evaluate/openai \\
  -H 'Content-Type: application/json' \\
  -H 'x-tripwire-api-key: twk_xxx' \\
  -d '{"tool_name":"shell.exec","tool_input":{"command":"ls -la"},"run_context":{"theme":"devops","mode":"hardened"}}'`
};

function revealDelay(ms: number): CSSProperties {
  return { "--docs-reveal-delay": `${ms}ms` } as CSSProperties;
}

export default function DocsPage() {
  return (
    <>
      <DocsMotionController integrationIntensity="medium" />

      <main className="page-shell">
        <SiteNav />

        <section className="page-intro docs-intro" id="top" data-docs-section="top" data-docs-reveal>
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
            <a href="#api" className="button button-secondary">
              API Quickstart
            </a>
          </div>
        </section>

        <nav className="docs-jump-nav" aria-label="Documentation sections" data-docs-reveal style={revealDelay(80)}>
          <a href="#flow">Execution flow</a>
          <a href="#quick-path">Quick path</a>
          <a href="#skill">Skill guidance</a>
          <a href="#api">API quickstart</a>
          <a href="#downloads">Download library</a>
        </nav>

        <section id="flow" className="docs-flow-grid" data-docs-section="flow">
          <article className="docs-flow-card" data-docs-reveal style={revealDelay(40)}>
            <p className="eyebrow">MODEL OUTPUT</p>
            <h2>Incoming tool calls are parsed and normalized.</h2>
            <p>TripWire receives call context before side effects happen.</p>
          </article>
          <article className="docs-flow-card" data-docs-reveal style={revealDelay(130)}>
            <p className="eyebrow">TRIPWIRE DECISIONING</p>
            <h2>Deterministic policy plus anomaly scoring decide the path.</h2>
            <p>Decision outcomes: allow, require approval, or block.</p>
          </article>
          <article className="docs-flow-card" data-docs-reveal style={revealDelay(220)}>
            <p className="eyebrow">DISPATCHER EXECUTION</p>
            <h2>Only approved calls proceed to runtime execution.</h2>
            <p>Blocked or escalated calls never reach unsafe side effects.</p>
          </article>
        </section>

        <section className="docs-path" id="quick-path" data-docs-section="quick-path">
          {quickPath.map((item, index) => (
            <article
              key={item.title}
              className="docs-path-card"
              data-docs-reveal
              style={revealDelay(40 + index * 90)}
            >
              <span>{item.step}</span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
              <a href={item.href} download>
                Download step doc
              </a>
            </article>
          ))}
        </section>

        <section className="docs-grid" id="skill" data-docs-section="skill">
          <article className="docs-card docs-card--skill" data-docs-reveal style={revealDelay(40)}>
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

          <article className="docs-card docs-card--note" data-docs-reveal style={revealDelay(140)}>
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

        <section className="docs-card docs-card--full" id="api" data-docs-section="api" data-docs-reveal>
          <p className="eyebrow">PUBLIC API</p>
          <h2>TripWire CTF API for external agent tool-call testing</h2>
          <p>
            Use the same API that powers the first-party challenge UI. The contract supports both TripWire native tool
            call schema and an OpenAI-compatible guardrail hook schema.
          </p>
          <div className="hero-actions">
            <a href="/openapi/v1.json" target="_blank" rel="noreferrer" className="button button-primary">
              OpenAPI JSON
            </a>
            <a href="/playground?tab=challenge" className="button button-secondary">
              Launch Challenge Tab
            </a>
          </div>
        </section>

        <section className="feature-grid">
          <article data-docs-reveal style={revealDelay(50)}>
            <h2>Auth</h2>
            <p>
              Initialize profile with cookie continuity, then call protected endpoints with
              <code> x-tripwire-api-key</code>.
            </p>
          </article>
          <article data-docs-reveal style={revealDelay(140)}>
            <h2>Rate limits</h2>
            <p>
              Default limits are 60 requests/minute and 2000 requests/day per key/profile with response headers for
              remaining quota.
            </p>
          </article>
          <article data-docs-reveal style={revealDelay(230)}>
            <h2>Moderation + safety</h2>
            <p>Blocked moderation requests return structured status and are logged into RL training datasets.</p>
          </article>
        </section>

        <section className="docs-card docs-card--full" data-docs-reveal>
          <p className="eyebrow">CURL QUICKSTART</p>
          <h2>Example requests</h2>
          <div className="challenge-curl-grid">
            <article data-docs-reveal style={revealDelay(40)}>
              <h3>1) Initialize profile</h3>
              <pre>{curlExamples.initProfile}</pre>
            </article>
            <article data-docs-reveal style={revealDelay(120)}>
              <h3>2) Create challenge session</h3>
              <pre>{curlExamples.createSession}</pre>
            </article>
            <article data-docs-reveal style={revealDelay(200)}>
              <h3>3) Submit direct tool attempt</h3>
              <pre>{curlExamples.toolAttempt}</pre>
            </article>
            <article data-docs-reveal style={revealDelay(280)}>
              <h3>4) OpenAI-compatible guard evaluate</h3>
              <pre>{curlExamples.guardEvaluateOpenAi}</pre>
            </article>
          </div>
        </section>

        <section className="docs-card docs-card--full" id="downloads" data-docs-section="downloads" data-docs-reveal>
          <p className="eyebrow">DOWNLOAD LIBRARY</p>
          <h2>Searchable markdown docs</h2>
          <p>All files are directly downloadable and can be previewed in-browser.</p>
          <DocsLibrary items={downloadables} />
        </section>
      </main>
    </>
  );
}
