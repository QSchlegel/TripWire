import Link from "next/link";
import { SiteNav } from "@/components/site-nav";

const references = [
  {
    name: "ThreatLocker Platform",
    focus: "Application allowlisting / ringfencing posture",
    url: "https://www.threatlocker.com/platform"
  },
  {
    name: "ThreatLocker Allowlisting model",
    focus: "Default-deny execution control principles",
    url: "https://www.threatlocker.com/blog/what-is-application-allowlisting"
  },
  {
    name: "OpenAI Agents JS Guardrails",
    focus: "Model/tool guardrails and policy hooks",
    url: "https://openai.github.io/openai-agents-js/guides/guardrails"
  },
  {
    name: "OpenAI Human-in-the-loop",
    focus: "Approval workflows in agent execution",
    url: "https://openai.github.io/openai-agents-js/guides/human-in-the-loop/"
  },
  {
    name: "LangChain Middleware",
    focus: "Interception of model and tool flows",
    url: "https://docs.langchain.com/oss/javascript/langchain/middleware"
  },
  {
    name: "NVIDIA NeMo Guardrails",
    focus: "Execution/input/output rail framework",
    url: "https://github.com/NVIDIA/NeMo-Guardrails"
  },
  {
    name: "Open Policy Agent",
    focus: "Policy-as-code reference architecture",
    url: "https://www.openpolicyagent.org/docs/latest/"
  },
  {
    name: "Lakera Guard docs",
    focus: "Managed AI firewall pattern",
    url: "https://docs.lakera.ai/guard"
  },
  {
    name: "Pangea AI Guard overview",
    focus: "API-first guard layer and audit model",
    url: "https://pangea.cloud/docs/ai-guard/overview"
  },
  {
    name: "Tetragon runtime enforcement",
    focus: "Runtime behavioral detection + enforce/monitor",
    url: "https://tetragon.io/docs/overview/"
  }
];

export default function ResearchPage() {
  return (
    <main className="page-shell">
      <SiteNav />
      <section className="page-intro">
        <p className="eyebrow">POSITIONING RESEARCH</p>
        <h1>Comparable solutions and design anchors for TripWire.</h1>
        <p>
          This matrix tracks adjacent control planes and guardrail systems to guide policy strategy, adapter decisions,
          and product positioning.
        </p>
      </section>

      <section className="research-list">
        {references.map((item) => (
          <article key={item.url}>
            <h2>{item.name}</h2>
            <p>{item.focus}</p>
            <Link href={item.url} target="_blank" rel="noreferrer">
              View reference →
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
