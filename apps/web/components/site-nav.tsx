"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Overview" },
  { href: "/simulator", label: "Simulator" },
  { href: "/research", label: "Research" },
  { href: "/docs", label: "Docs" }
];

export function SiteNav() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("tripwire-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
      setTheme(stored);
      return;
    }

    const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const inferred = prefersLight ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", inferred);
    setTheme(inferred);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    window.localStorage.setItem("tripwire-theme", next);
    setTheme(next);
  };

  const themeButtonLabel =
    theme === "light" ? "Switch to Dark" : theme === "dark" ? "Switch to Light" : "Toggle Theme";
  const currentTheme = theme ?? "dark";

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
          onClick={toggleTheme}
          aria-label={`Toggle theme. Current mode: ${currentTheme}.`}
          title={`Current: ${currentTheme} mode`}
        >
          {themeButtonLabel}
        </button>
      </div>
    </header>
  );
}
