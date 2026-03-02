import { SiteNav } from "@/components/site-nav";
import { PlaygroundWorkbench, type PlaygroundTab } from "@/components/playground-workbench";

interface PlaygroundPageProps {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
}

function normalizeTab(value: string | undefined): PlaygroundTab {
  return value === "challenge" || value === "simulator" ? value : "simulator";
}

export default async function PlaygroundPage({ searchParams }: PlaygroundPageProps) {
  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab = normalizeTab(rawTab);

  return (
    <main className="page-shell">
      <SiteNav />

      <section className="page-intro">
        <p className="eyebrow">PLAYGROUND</p>
        <h1>Policy simulator and live challenge in one workspace.</h1>
        <p>
          Switch between tabs without losing state. Deep-link directly to either tool via{" "}
          <code>?tab=simulator</code> or <code>?tab=challenge</code>.
        </p>
      </section>

      <PlaygroundWorkbench initialTab={initialTab} />
    </main>
  );
}
