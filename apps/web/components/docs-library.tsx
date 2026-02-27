"use client";

import { useMemo, useState } from "react";

export interface DocsAsset {
  title: string;
  description: string;
  href: string;
  category: "quickstart" | "policy" | "reference";
  tags: string[];
  recommended?: boolean;
}

interface DocsLibraryProps {
  items: DocsAsset[];
}

const categoryLabels: Record<DocsAsset["category"], string> = {
  quickstart: "Quickstart",
  policy: "Policy + Governance",
  reference: "Reference"
};

export function DocsLibrary({ items }: DocsLibraryProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | DocsAsset["category"]>("all");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!normalizedQuery) return true;
      const haystack = [item.title, item.description, ...item.tags].join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [category, items, query]);

  return (
    <section className="docs-library">
      <div className="docs-library__controls">
        <label className="docs-search">
          <span>Search docs</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title, topic, or keyword"
            aria-label="Search documentation"
          />
        </label>

        <div className="docs-filter-group" aria-label="Filter docs by category">
          <button
            type="button"
            aria-pressed={category === "all"}
            className={category === "all" ? "docs-filter docs-filter--active" : "docs-filter"}
            onClick={() => setCategory("all")}
          >
            All
          </button>
          {(Object.keys(categoryLabels) as DocsAsset["category"][]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              className={category === key ? "docs-filter docs-filter--active" : "docs-filter"}
              onClick={() => setCategory(key)}
            >
              {categoryLabels[key]}
            </button>
          ))}
        </div>

        <p className="docs-library__count">
          Showing {filteredItems.length} of {items.length} docs
        </p>
      </div>

      <div className="docs-download-list">
        {filteredItems.length === 0 ? (
          <article className="docs-empty-state">
            <h3>No docs found for this filter.</h3>
            <p>Try a broader keyword or switch to the All category.</p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              Reset Filters
            </button>
          </article>
        ) : (
          filteredItems.map((item) => (
            <article key={item.href} className="docs-download-item">
              <div className="docs-download-item__meta">
                <span>{categoryLabels[item.category]}</span>
                {item.recommended ? <span>Recommended</span> : null}
              </div>

              <strong>{item.title}</strong>
              <p>{item.description}</p>

              <div className="docs-tag-row">
                {item.tags.map((tag) => (
                  <span key={tag} className="docs-tag">
                    {tag}
                  </span>
                ))}
              </div>

              <div className="docs-download-item__actions">
                <a href={item.href} download className="button button-primary">
                  Download
                </a>
                <a href={item.href} target="_blank" rel="noreferrer" className="button button-secondary">
                  Preview
                </a>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
