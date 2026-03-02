"use client";

import { useMemo, useState } from "react";

const INSTALL_OPTIONS = [
  { id: "npm", label: "npm", command: "npm i @twire/guard" },
  { id: "pip", label: "pip", command: "pip install tripwire-guard" },
  { id: "pnpm", label: "pnpm", command: "pnpm add @twire/guard" },
  { id: "yarn", label: "yarn", command: "yarn add @twire/guard" },
  { id: "bun", label: "bun", command: "bun add @twire/guard" }
] as const;

type InstallOption = (typeof INSTALL_OPTIONS)[number];

export function InstallTabs() {
  const [activeId, setActiveId] = useState<InstallOption["id"]>(INSTALL_OPTIONS[0].id);
  const activeOption = useMemo(
    () => INSTALL_OPTIONS.find((option) => option.id === activeId) ?? INSTALL_OPTIONS[0],
    [activeId]
  );

  return (
    <div className="install-card">
      <div className="install-tabs" role="tablist" aria-label="Install with package manager or pip">
        {INSTALL_OPTIONS.map((option) => (
          <button
            key={option.id}
            id={`install-tab-${option.id}`}
            type="button"
            role="tab"
            className="install-tab"
            aria-selected={option.id === activeOption.id}
            aria-controls={`install-panel-${option.id}`}
            onClick={() => setActiveId(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div
        id={`install-panel-${activeOption.id}`}
        role="tabpanel"
        className="install-panel"
        aria-labelledby={`install-tab-${activeOption.id}`}
      >
        <code className="install-command">{activeOption.command}</code>
      </div>
    </div>
  );
}
