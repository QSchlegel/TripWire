"use client";

import { useEffect, useState } from "react";
import {
  DESIGNER_ACTIONS,
  DESIGNER_METRICS,
  DESIGNER_MODES,
  DESIGNER_SEVERITIES,
  createDefaultAnomaly,
  createDefaultDesignerState,
  createDefaultRule,
  designerStateToPolicy,
  policyToDesignerState,
  type DesignerAnomaly,
  type DesignerRule,
  type DesignerState
} from "@/lib/policy-designer";

interface VisualPolicyDesignerProps {
  policyText: string;
  onPolicyChange: (nextPolicy: string) => void;
  disabled?: boolean;
}

function nextId(prefix: string, values: string[]): string {
  let i = values.length + 1;
  let candidate = `${prefix}.${i}`;
  while (values.includes(candidate)) {
    i += 1;
    candidate = `${prefix}.${i}`;
  }
  return candidate;
}

function formatOptionLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function VisualPolicyDesigner({ policyText, onPolicyChange, disabled }: VisualPolicyDesignerProps) {
  const [designerState, setDesignerState] = useState<DesignerState>(() => {
    try {
      return policyToDesignerState(policyText);
    } catch {
      return createDefaultDesignerState();
    }
  });
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastAppliedPolicy, setLastAppliedPolicy] = useState<string | null>(null);

  useEffect(() => {
    if (lastAppliedPolicy !== null && policyText === lastAppliedPolicy) return;

    try {
      const nextState = policyToDesignerState(policyText);
      setDesignerState(nextState);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to parse markdown policy.");
    }
  }, [lastAppliedPolicy, policyText]);

  const applyDesignerUpdate = (updater: (current: DesignerState) => DesignerState) => {
    const nextState = updater(designerState);
    const nextPolicy = designerStateToPolicy(nextState);
    setDesignerState(nextState);
    setLastAppliedPolicy(nextPolicy);
    setSyncError(null);
    onPolicyChange(nextPolicy);
  };

  const updateRule = (index: number, updater: (rule: DesignerRule) => DesignerRule) => {
    applyDesignerUpdate((current) => ({
      ...current,
      rules: current.rules.map((rule, i) => (i === index ? updater(rule) : rule))
    }));
  };

  const updateAnomaly = (index: number, updater: (rule: DesignerAnomaly) => DesignerAnomaly) => {
    applyDesignerUpdate((current) => ({
      ...current,
      anomalies: current.anomalies.map((rule, i) => (i === index ? updater(rule) : rule))
    }));
  };

  const importFromMarkdown = () => {
    try {
      const nextState = policyToDesignerState(policyText);
      setDesignerState(nextState);
      setSyncError(null);
      setLastAppliedPolicy(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to parse markdown policy.");
    }
  };

  return (
    <section className="policy-designer" aria-label="Visual policy designer">
      <div className="policy-designer__meta">
        <label>
          Policy ID
          <input
            type="text"
            value={designerState.id}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                id: event.target.value
              }))
            }
          />
        </label>

        <label>
          Version
          <input
            type="number"
            min={1}
            value={designerState.version}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                version: event.target.value
              }))
            }
          />
        </label>

        <label>
          Mode
          <select
            value={designerState.mode}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                mode: event.target.value as DesignerState["mode"]
              }))
            }
          >
            {DESIGNER_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tags (comma-separated)
          <input
            type="text"
            value={designerState.tagsCsv}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                tagsCsv: event.target.value
              }))
            }
          />
        </label>

        <label>
          Default action
          <select
            value={designerState.defaultAction}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                defaultAction: event.target.value as DesignerState["defaultAction"]
              }))
            }
          >
            {DESIGNER_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {formatOptionLabel(action)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Default severity
          <select
            value={designerState.defaultSeverity}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                defaultSeverity: event.target.value as DesignerState["defaultSeverity"]
              }))
            }
          >
            {DESIGNER_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>

        <label>
          Default confidence
          <input
            type="number"
            step="0.01"
            value={designerState.defaultConfidence}
            disabled={disabled}
            onChange={(event) =>
              applyDesignerUpdate((current) => ({
                ...current,
                defaultConfidence: event.target.value
              }))
            }
          />
        </label>
      </div>

      <div className="policy-designer__group">
        <div className="policy-designer__group-header">
          <h3>Rules</h3>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              applyDesignerUpdate((current) => ({
                ...current,
                rules: [...current.rules, createDefaultRule(nextId("rule.custom", current.rules.map((r) => r.id)))]
              }))
            }
          >
            Add Rule
          </button>
        </div>

        <div className="policy-designer__cards">
          {designerState.rules.map((rule, index) => (
            <article key={`${rule.id}-${index}`} className="policy-designer-card">
              <div className="policy-designer-card__header">
                <strong>Rule {index + 1}</strong>
                <button
                  type="button"
                  disabled={disabled || designerState.rules.length <= 1}
                  onClick={() =>
                    applyDesignerUpdate((current) => ({
                      ...current,
                      rules: current.rules.filter((_, i) => i !== index)
                    }))
                  }
                >
                  Remove
                </button>
              </div>

              <div className="policy-designer-card__grid">
                <label>
                  Rule ID
                  <input
                    type="text"
                    value={rule.id}
                    disabled={disabled}
                    onChange={(event) => updateRule(index, (current) => ({ ...current, id: event.target.value }))}
                  />
                </label>

                <label>
                  Title (optional)
                  <input
                    type="text"
                    value={rule.title}
                    disabled={disabled}
                    onChange={(event) => updateRule(index, (current) => ({ ...current, title: event.target.value }))}
                  />
                </label>

                <label>
                  Category
                  <input
                    type="text"
                    value={rule.category}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({ ...current, category: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Severity
                  <select
                    value={rule.severity}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({
                        ...current,
                        severity: event.target.value as DesignerRule["severity"]
                      }))
                    }
                  >
                    {DESIGNER_SEVERITIES.map((severity) => (
                      <option key={severity} value={severity}>
                        {severity}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Action
                  <select
                    value={rule.action}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({
                        ...current,
                        action: event.target.value as DesignerRule["action"]
                      }))
                    }
                  >
                    {DESIGNER_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {formatOptionLabel(action)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Confidence (optional)
                  <input
                    type="number"
                    step="0.01"
                    value={rule.confidence}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({ ...current, confidence: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Tool matcher (comma-separated)
                  <input
                    type="text"
                    value={rule.toolCsv}
                    disabled={disabled}
                    onChange={(event) => updateRule(index, (current) => ({ ...current, toolCsv: event.target.value }))}
                  />
                </label>

                <label>
                  Regex flags (optional)
                  <input
                    type="text"
                    value={rule.textFlags}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({ ...current, textFlags: event.target.value }))
                    }
                  />
                </label>

                <label className="policy-designer-card__wide">
                  Text regex
                  <input
                    type="text"
                    value={rule.textRegex}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({ ...current, textRegex: event.target.value }))
                    }
                  />
                </label>

                <label className="policy-designer-card__wide">
                  Why
                  <textarea
                    value={rule.why}
                    disabled={disabled}
                    onChange={(event) => updateRule(index, (current) => ({ ...current, why: event.target.value }))}
                  />
                </label>

                <label className="policy-designer-card__wide">
                  Suggestion
                  <textarea
                    value={rule.suggestion}
                    disabled={disabled}
                    onChange={(event) =>
                      updateRule(index, (current) => ({ ...current, suggestion: event.target.value }))
                    }
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="policy-designer__group">
        <div className="policy-designer__group-header">
          <h3>Anomaly Rules</h3>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              applyDesignerUpdate((current) => ({
                ...current,
                anomalies: [
                  ...current.anomalies,
                  createDefaultAnomaly(nextId("anomaly.custom", current.anomalies.map((a) => a.id)))
                ]
              }))
            }
          >
            Add Anomaly
          </button>
        </div>

        <div className="policy-designer__cards">
          {designerState.anomalies.map((rule, index) => (
            <article key={`${rule.id}-${index}`} className="policy-designer-card">
              <div className="policy-designer-card__header">
                <strong>Anomaly {index + 1}</strong>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    applyDesignerUpdate((current) => ({
                      ...current,
                      anomalies: current.anomalies.filter((_, i) => i !== index)
                    }))
                  }
                >
                  Remove
                </button>
              </div>

              <div className="policy-designer-card__grid">
                <label>
                  Rule ID
                  <input
                    type="text"
                    value={rule.id}
                    disabled={disabled}
                    onChange={(event) => updateAnomaly(index, (current) => ({ ...current, id: event.target.value }))}
                  />
                </label>

                <label>
                  Metric
                  <select
                    value={rule.metric}
                    disabled={disabled}
                    onChange={(event) =>
                      updateAnomaly(index, (current) => ({
                        ...current,
                        metric: event.target.value as DesignerAnomaly["metric"]
                      }))
                    }
                  >
                    {DESIGNER_METRICS.map((metric) => (
                      <option key={metric} value={metric}>
                        {metric}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Threshold
                  <input
                    type="number"
                    step="0.01"
                    value={rule.threshold}
                    disabled={disabled}
                    onChange={(event) =>
                      updateAnomaly(index, (current) => ({ ...current, threshold: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Window ms
                  <input
                    type="number"
                    step="1"
                    value={rule.windowMs}
                    disabled={disabled}
                    onChange={(event) =>
                      updateAnomaly(index, (current) => ({ ...current, windowMs: event.target.value }))
                    }
                  />
                </label>

                <label>
                  Action
                  <select
                    value={rule.action}
                    disabled={disabled}
                    onChange={(event) =>
                      updateAnomaly(index, (current) => ({
                        ...current,
                        action: event.target.value as DesignerAnomaly["action"]
                      }))
                    }
                  >
                    {DESIGNER_ACTIONS.map((action) => (
                      <option key={action} value={action}>
                        {formatOptionLabel(action)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Weight
                  <input
                    type="number"
                    step="0.01"
                    value={rule.weight}
                    disabled={disabled}
                    onChange={(event) =>
                      updateAnomaly(index, (current) => ({ ...current, weight: event.target.value }))
                    }
                  />
                </label>

                <label className="policy-designer-card__wide">
                  Why (optional)
                  <textarea
                    value={rule.why}
                    disabled={disabled}
                    onChange={(event) => updateAnomaly(index, (current) => ({ ...current, why: event.target.value }))}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="policy-designer__footer">
        <button type="button" onClick={importFromMarkdown} disabled={disabled}>
          Reload Designer from Markdown
        </button>
        {syncError ? (
          <p className="policy-designer__sync-error">
            Markdown parse warning: {syncError}. Designer stays on the last valid policy.
          </p>
        ) : (
          <p className="policy-designer__sync-ok">Designer and markdown are in sync.</p>
        )}
      </div>
    </section>
  );
}
