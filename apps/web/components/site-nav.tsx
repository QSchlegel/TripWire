"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

const links = [
  { href: "/playground", label: "Playground" },
  { href: "/docs", label: "Docs" }
];

const CYCLE: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function applyTheme(theme: Theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function SiteNav() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem("tripwire-theme");
    if (stored === "light" || stored === "dark") {
      applyTheme(stored);
      setTheme(stored);
    } else {
      // No explicit user preference — remove data-theme and let CSS media query apply.
      document.documentElement.removeAttribute("data-theme");
      setTheme("system");
    }

    // When in system mode, re-render if the OS preference changes so the label stays accurate.
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onMqChange = () => {
      const current = window.localStorage.getItem("tripwire-theme");
      if (current !== "light" && current !== "dark") setTheme("system");
    };
    mq.addEventListener("change", onMqChange);
    return () => mq.removeEventListener("change", onMqChange);
  }, []);

  const cycleTheme = () => {
    const next = CYCLE[theme];
    applyTheme(next);
    if (next === "system") {
      window.localStorage.removeItem("tripwire-theme");
    } else {
      window.localStorage.setItem("tripwire-theme", next);
    }
    setTheme(next);
  };

  const label = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";
  const nextLabel = CYCLE[theme].charAt(0).toUpperCase() + CYCLE[theme].slice(1);

  return (
    <header className="site-header">
      <Link href="/" className="brand-mark" aria-label="TripWire home">
        <span className="brand-mark__dot" />
        <span>TripWire</span>
      </Link>

      <div className="site-header__controls">
        <nav className="site-nav">
          {links.map((link) => {
            const isActive = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} className={isActive ? "nav-link nav-link--active" : "nav-link"}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          className="theme-toggle"
          onClick={cycleTheme}
          aria-label={`Color scheme: ${label}. Click to switch to ${nextLabel}.`}
          title={`Color scheme: ${label}`}
        >
          {label}
        </button>
      </div>
    </header>
  );
}
