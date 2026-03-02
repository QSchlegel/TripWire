"use client";

import { useEffect, useState } from "react";
import { DocsBackgroundScene, type DocsIntegrationIntensity, type DocsSectionId } from "./docs-infographic";

const SECTION_SELECTOR = "[data-docs-section]";
const REVEAL_SELECTOR = "[data-docs-reveal]";
const SECTION_IDS: DocsSectionId[] = ["top", "flow", "quick-path", "skill", "api", "downloads"];

function asSectionId(value: string | null | undefined): DocsSectionId | null {
  if (!value) return null;
  return SECTION_IDS.includes(value as DocsSectionId) ? (value as DocsSectionId) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveDocumentProgress(): number {
  const root = document.documentElement;
  const maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
  return clamp(window.scrollY / maxScroll, 0, 1);
}

interface DocsMotionControllerProps {
  integrationIntensity?: DocsIntegrationIntensity;
}

export function DocsMotionController({ integrationIntensity = "medium" }: DocsMotionControllerProps) {
  const [activeSection, setActiveSection] = useState<DocsSectionId>("top");
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-docs-animate", "ready");
    return () => {
      root.removeAttribute("data-docs-animate");
    };
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        setScrollProgress(resolveDocumentProgress());
      });
    };

    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR));
    if (sections.length === 0) return;

    const ratios = new Map<HTMLElement, number>();
    sections.forEach((section) => {
      ratios.set(section, 0);
    });

    const resolveFallbackSection = (): DocsSectionId => {
      const markerY = window.innerHeight * 0.36;
      let closest: DocsSectionId = "top";
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const section of sections) {
        const id = asSectionId(section.dataset.docsSection);
        if (!id) continue;
        const rect = section.getBoundingClientRect();
        const distance = Math.abs(rect.top - markerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          closest = id;
        }
      }

      return closest;
    };

    const resolveActiveSection = () => {
      let nextSection: DocsSectionId = "top";
      let bestRatio = 0;

      for (const section of sections) {
        const id = asSectionId(section.dataset.docsSection);
        if (!id) continue;
        const ratio = ratios.get(section) ?? 0;
        if (ratio > bestRatio) {
          bestRatio = ratio;
          nextSection = id;
        }
      }

      if (bestRatio <= 0.01) {
        nextSection = resolveFallbackSection();
      }

      setActiveSection((current) => (current === nextSection ? current : nextSection));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.set(entry.target as HTMLElement, entry.isIntersecting ? entry.intersectionRatio : 0);
        }
        resolveActiveSection();
      },
      {
        threshold: [0, 0.08, 0.16, 0.24, 0.35, 0.5, 0.65, 0.8, 1],
        rootMargin: "-12% 0px -40% 0px"
      }
    );

    sections.forEach((section) => observer.observe(section));
    resolveActiveSection();

    const onResize = () => {
      resolveActiveSection();
    };

    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (nodes.length === 0) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const revealAll = () => {
      for (const node of nodes) {
        node.dataset.docsRevealed = "true";
      }
    };

    if (reducedMotion.matches) {
      revealAll();
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio < 0.18) continue;
          const node = entry.target as HTMLElement;
          node.dataset.docsRevealed = "true";
          revealObserver.unobserve(node);
        }
      },
      {
        threshold: [0, 0.18, 0.42],
        rootMargin: "0px 0px -12% 0px"
      }
    );

    nodes.forEach((node) => {
      if (node.dataset.docsRevealed === "true") return;
      revealObserver.observe(node);
    });

    const onMotionChange = () => {
      if (!reducedMotion.matches) return;
      revealObserver.disconnect();
      revealAll();
    };

    reducedMotion.addEventListener("change", onMotionChange);

    return () => {
      revealObserver.disconnect();
      reducedMotion.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <DocsBackgroundScene
      activeSection={activeSection}
      scrollProgress={scrollProgress}
      integrationIntensity={integrationIntensity}
    />
  );
}
