"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChallengeConsole } from "@/components/challenge-console";
import { PolicySimulator } from "@/components/policy-simulator";

export type PlaygroundTab = "simulator" | "challenge";

interface PlaygroundWorkbenchProps {
  initialTab: PlaygroundTab;
}

export function PlaygroundWorkbench({ initialTab }: PlaygroundWorkbenchProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<PlaygroundTab>(initialTab);
  const [mountedTabs, setMountedTabs] = useState<Record<PlaygroundTab, boolean>>({
    simulator: initialTab === "simulator",
    challenge: initialTab === "challenge"
  });

  const setTab = (nextTab: PlaygroundTab) => {
    if (nextTab === activeTab) return;

    setActiveTab(nextTab);
    setMountedTabs((previous) => (previous[nextTab] ? previous : { ...previous, [nextTab]: true }));

    const nextUrl = `${pathname}?tab=${nextTab}`;
    router.replace(nextUrl, { scroll: false });
  };

  const shellClassName =
    activeTab === "simulator"
      ? "playground-shell playground-shell--simulator-active"
      : "playground-shell";

  return (
    <section className={shellClassName}>
      <div className="playground-tabs" role="tablist" aria-label="Playground tools">
        <button
          id="playground-tab-simulator"
          type="button"
          role="tab"
          aria-selected={activeTab === "simulator"}
          aria-controls="playground-panel-simulator"
          className={activeTab === "simulator" ? "playground-tab playground-tab--active" : "playground-tab"}
          tabIndex={activeTab === "simulator" ? 0 : -1}
          onClick={() => setTab("simulator")}
        >
          Simulator
        </button>

        <button
          id="playground-tab-challenge"
          type="button"
          role="tab"
          aria-selected={activeTab === "challenge"}
          aria-controls="playground-panel-challenge"
          className={activeTab === "challenge" ? "playground-tab playground-tab--active" : "playground-tab"}
          tabIndex={activeTab === "challenge" ? 0 : -1}
          onClick={() => setTab("challenge")}
        >
          Challenge
        </button>
      </div>

      <section
        id="playground-panel-simulator"
        role="tabpanel"
        aria-labelledby="playground-tab-simulator"
        hidden={activeTab !== "simulator"}
        className="playground-panel playground-panel--simulator"
      >
        {mountedTabs.simulator ? <PolicySimulator /> : null}
      </section>

      <section
        id="playground-panel-challenge"
        role="tabpanel"
        aria-labelledby="playground-tab-challenge"
        hidden={activeTab !== "challenge"}
        className="playground-panel playground-panel--challenge"
      >
        {mountedTabs.challenge ? <ChallengeConsole /> : null}
      </section>
    </section>
  );
}
