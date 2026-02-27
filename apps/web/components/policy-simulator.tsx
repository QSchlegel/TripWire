"use client";

import { InMemoryStore, PolicyCompileError, compilePolicy, createGuard } from "@tripwire/guard";
import type { GuardDecisionResult } from "@tripwire/guard";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SimulatorDecisionScene } from "@/components/simulator-decision-scene";
import { VisualPolicyDesigner } from "@/components/visual-policy-designer";
import { evaluateSimulatorEvent } from "@/lib/simulator-evaluator";
import { sampleEventsJsonl, samplePolicy } from "@/lib/samples";
import {
  simulatorSmokeCases,
  simulatorSmokeCasesById,
  smokeCaseToJsonl,
  type SimulatorExecutionStatus
} from "@/lib/simulator-smoke-cases";

interface EventWithResult {
  index: number;
  raw: string;
  parsed: Record<string, unknown>;
  result: GuardDecisionResult;
  execution: SimulatorExecutionStatus;
  chainEscalated: boolean;
  reviewReasons: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function approvalReason(event: Record<string, unknown>): string | undefined {
  const approval = asRecord(event.approval);
  if (!approval) return undefined;
  return typeof approval.reason === "string" ? approval.reason : undefined;
}

function executionLabel(execution: SimulatorExecutionStatus): string {
  if (execution === "executed") return "executed";
  if (execution === "blocked") return "blocked";
  if (execution === "approval_denied") return "approval denied";
  return "approval required";
}

function normalizePolicyMarkdownForPreview(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown;
  const closing = markdown.indexOf("\n---\n", 4);
  if (closing === -1) return markdown;

  const frontmatter = markdown.slice(4, closing).trimEnd();
  const body = markdown.slice(closing + 5).trimStart();
  const frontmatterBlock = `\`\`\`yaml\n${frontmatter}\n\`\`\``;
  if (!body) return frontmatterBlock;
  return `${frontmatterBlock}\n\n${body}`;
}

export function PolicySimulator() {
  const [policyText, setPolicyText] = useState(samplePolicy);
  const [policyEditorMode, setPolicyEditorMode] = useState<"visual" | "markdown">("visual");
  const [eventsText, setEventsText] = useState(sampleEventsJsonl);
  const [selectedCaseId, setSelectedCaseId] = useState(simulatorSmokeCases[0]?.id ?? "");
  const [results, setResults] = useState<EventWithResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStepping, setIsStepping] = useState(false);
  const [playbackSpeedMs, setPlaybackSpeedMs] = useState(3000);
  const [playbackToken, setPlaybackToken] = useState(0);
  const [liveLog, setLiveLog] = useState<string[]>([]);
  const loadUseCaseRef = useRef<(id: string) => void>(() => {});

  const summary = useMemo(() => {
    const totals = {
      events: results.length,
      allow: 0,
      require_approval: 0,
      block: 0
    };

    let avgAnomaly = 0;

    for (const entry of results) {
      totals[entry.result.decision] += 1;
      avgAnomaly += entry.result.anomaly.score;
    }

    if (results.length > 0) {
      avgAnomaly /= results.length;
    }

    return {
      ...totals,
      avgAnomaly: avgAnomaly.toFixed(3)
    };
  }, [results]);

  const activeEntry =
    activeResultIndex >= 0 && activeResultIndex < results.length ? results[activeResultIndex] : undefined;

  // Auto-load and run the first scenario on mount
  useEffect(() => {
    const firstCase = simulatorSmokeCases[0];
    if (firstCase) loadUseCase(firstCase.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSimulationCore = async (policy: string, events: string) => {
    setIsRunning(true);
    setError(null);
    setIsPlaying(false);
    setIsStepping(false);
    const logs: string[] = [];

    try {
      const compiled = compilePolicy(policy);
      const guard = createGuard({
        policy: compiled,
        store: new InMemoryStore(),
        chainOfCommand: { enabled: true, maxEscalationLevels: 3 }
      });

      const lines = events
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      logs.push(`Running ${lines.length} event(s) through TripWire.`);
      const next: EventWithResult[] = [];

      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const simulation = await evaluateSimulatorEvent(guard, parsed);
        next.push({
          index: i,
          raw,
          parsed,
          result: simulation.result,
          execution: simulation.execution,
          chainEscalated: simulation.chainEscalated,
          reviewReasons: simulation.reviewReasons
        });

        const command = typeof parsed.text === "string" ? parsed.text : "unknown command";
        const tool = typeof parsed.tool === "string" ? parsed.tool : "unknown";
        const approvalNote = approvalReason(parsed);
        const reviewNote = simulation.reviewReasons.length > 0 ? ` | review: ${simulation.reviewReasons.join(" | ")}` : "";
        const approveNote = approvalNote ? ` | approval reason: ${approvalNote}` : "";

        logs.push(
          `#${i + 1} ${tool} "${command}" => decision=${simulation.result.decision}, execution=${simulation.execution}, chain=${simulation.result.chainOfCommand.status}, escalated=${simulation.chainEscalated}${reviewNote}${approveNote}`
        );
      }

      setResults(next);
      setActiveResultIndex(0);
      setPlaybackToken((value) => value + 1);
      setLiveLog(logs);
      if (next.length > 0) setIsPlaying(true);
    } catch (err) {
      if (err instanceof PolicyCompileError) {
        setError(`Policy error [${err.code}] at ${err.line}:${err.column} - ${err.message}`);
        logs.push(`Simulation failed: policy compile error ${err.code} at ${err.line}:${err.column}.`);
      } else if (err instanceof Error) {
        setError(err.message);
        logs.push(`Simulation failed: ${err.message}`);
      } else {
        setError("Unknown simulator error");
        logs.push("Simulation failed: unknown simulator error.");
      }
      setLiveLog(logs);
    } finally {
      setIsRunning(false);
    }
  };

  const loadUseCase = (caseId: string) => {
    const useCase = simulatorSmokeCasesById[caseId];
    if (!useCase || isRunning) return;
    setSelectedCaseId(caseId);
    setPolicyText(useCase.policy);
    setEventsText(smokeCaseToJsonl(useCase));
    setResults([]);
    setError(null);
    setIsPlaying(false);
    setIsStepping(false);
    setActiveResultIndex(-1);
    setPlaybackToken((value) => value + 1);
    void runSimulationCore(useCase.policy, smokeCaseToJsonl(useCase));
  };
  loadUseCaseRef.current = loadUseCase;

  const togglePlayback = () => {
    if (results.length === 0) return;

    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    setIsStepping(false);
    if (activeResultIndex < 0 || activeResultIndex >= results.length - 1) {
      setActiveResultIndex(0);
      setPlaybackToken((value) => value + 1);
    }

    setIsPlaying(true);
  };

  const stepPlayback = () => {
    if (results.length === 0) return;

    setIsPlaying(false);
    setIsStepping(true);
    setActiveResultIndex((current) => {
      if (current < 0) return 0;
      return Math.min(current + 1, results.length - 1);
    });
    setPlaybackToken((value) => value + 1);
  };

  const resetPlayback = () => {
    setIsPlaying(false);
    setIsStepping(false);
    setActiveResultIndex(results.length > 0 ? 0 : -1);
    setPlaybackToken((value) => value + 1);
  };

  const handleAnimationComplete = (completedIndex: number) => {
    if (completedIndex !== activeResultIndex || completedIndex < 0) return;

    if (isStepping) {
      setIsStepping(false);
      return;
    }

    if (!isPlaying) return;

    if (completedIndex < results.length - 1) {
      setActiveResultIndex(completedIndex + 1);
      setPlaybackToken((value) => value + 1);
      return;
    }

    const currentIdx = simulatorSmokeCases.findIndex((sc) => sc.id === selectedCaseId);
    const nextCase = simulatorSmokeCases[(currentIdx + 1) % simulatorSmokeCases.length];
    if (nextCase) {
      loadUseCaseRef.current(nextCase.id);
      return;
    }

    setIsPlaying(false);
  };

  const runSimulation = async () => {
    await runSimulationCore(policyText, eventsText);
  };

  const activeTool =
    activeEntry && typeof activeEntry.parsed.tool === "string"
      ? activeEntry.parsed.tool
      : activeEntry && typeof activeEntry.parsed.toolName === "string"
        ? activeEntry.parsed.toolName
        : "unknown";

  const activeCommand =
    activeEntry && typeof activeEntry.parsed.text === "string" ? activeEntry.parsed.text : "No command text";

  const policyPreviewMarkdown = useMemo(() => normalizePolicyMarkdownForPreview(policyText), [policyText]);

  return (
    <section className="simulator-shell">
      <section className="simulator-flow-panel" aria-label="Decision flow animation">
        <div className="simulator-flow-scene">
          <SimulatorDecisionScene
            activeDecision={activeEntry?.result.decision}
            activeExecution={activeEntry?.execution}
            activeChainStatus={activeEntry?.result.chainOfCommand.status}
            activeChainEscalated={activeEntry?.chainEscalated}
            activeIndex={activeResultIndex}
            playbackToken={playbackToken}
            eventDurationMs={playbackSpeedMs}
            isPlaying={isPlaying || isStepping}
            onAnimationComplete={handleAnimationComplete}
            reducedMotionFallbackMode="auto"
          />
        </div>

        <div className="simulator-flow-meta">
          <h3>Active Event</h3>
          {activeEntry ? (
            <>
              <p className="simulator-flow-meta__line">
                <strong>Event:</strong> #{activeEntry.index + 1} / {results.length}
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Tool:</strong> {activeTool}
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Command:</strong> {activeCommand}
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Decision:</strong>{" "}
                <span className={`decision-badge decision-badge--${activeEntry.result.decision}`}>
                  {activeEntry.result.decision.replace("_", " ")}
                </span>
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Execution:</strong>{" "}
                <span className={`execution-badge execution-badge--${activeEntry.execution}`}>
                  {executionLabel(activeEntry.execution)}
                </span>
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Chain:</strong> {activeEntry.result.chainOfCommand.status}
              </p>
              <p className="simulator-flow-meta__line">
                <strong>Escalated:</strong> {String(activeEntry.chainEscalated)}
              </p>
              {activeEntry.reviewReasons.length > 0 ? (
                <p className="simulator-flow-meta__line">
                  <strong>Reason:</strong> {activeEntry.reviewReasons.join("; ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="simulator-flow-meta__empty">
              Select a scenario to start the simulation.
            </p>
          )}

          <div className="simulator-lane-legend">
            <span className="simulator-lane-legend__item simulator-lane-legend__item--allow">Green: allow</span>
            <span className="simulator-lane-legend__item simulator-lane-legend__item--approval">
              Amber: supervisor approval gate
            </span>
            <span className="simulator-lane-legend__item simulator-lane-legend__item--block">Red: block</span>
          </div>
        </div>
      </section>

      <div className="sim-scenarios">
        <p className="sim-section-label">Scenarios</p>
        <div className="sim-scenario-grid">
          {simulatorSmokeCases.map((sc, index) => {
            const isActive = selectedCaseId === sc.id;
            const scenarioId = `SC-${String(index + 1).padStart(2, "0")}`;

            return (
              <button
                key={sc.id}
                type="button"
                disabled={isRunning}
                onClick={() => loadUseCase(sc.id)}
                aria-pressed={isActive}
                className={`sim-scenario-card${isActive ? " sim-scenario-card--active" : ""}`}
              >
                <span className="sim-scenario-card__meta">
                  <span className="sim-scenario-card__id">{scenarioId}</span>
                  {isActive ? <span className="sim-scenario-card__state">Active</span> : null}
                </span>
                <span className="sim-scenario-card__name">{sc.name}</span>
                <span className="sim-scenario-card__desc">{sc.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="simulator-controls">
        <div className="simulator-policy-editor">
          <div className="simulator-policy-editor__header">
            <div>
              <h2>Guard Policy</h2>
              <p>Build rules visually or edit structured Markdown policy directly.</p>
            </div>

            <div className="simulator-policy-editor__tabs" role="tablist" aria-label="Policy editor mode">
              <button
                type="button"
                role="tab"
                aria-selected={policyEditorMode === "visual"}
                className={policyEditorMode === "visual" ? "is-active" : ""}
                onClick={() => setPolicyEditorMode("visual")}
              >
                Visual Designer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={policyEditorMode === "markdown"}
                className={policyEditorMode === "markdown" ? "is-active" : ""}
                onClick={() => setPolicyEditorMode("markdown")}
              >
                Markdown
              </button>
            </div>
          </div>

          {policyEditorMode === "visual" ? (
            <VisualPolicyDesigner policyText={policyText} onPolicyChange={setPolicyText} disabled={isRunning} />
          ) : (
            <div className="simulator-policy-markdown">
              <section className="simulator-policy-markdown__panel">
                <p className="simulator-policy-markdown__panel-label">Rendered Policy Preview</p>
                <div className="simulator-policy-markdown__preview" aria-label="Rendered policy markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{policyPreviewMarkdown}</ReactMarkdown>
                </div>
              </section>
              <label htmlFor="sim-policy" className="simulator-policy-markdown__panel simulator-policy-markdown__panel--editor">
                <span className="simulator-policy-markdown__editor-label">Policy Markdown Source</span>
                <textarea
                  id="sim-policy"
                  className="simulator-policy-markdown__textarea"
                  value={policyText}
                  onChange={(event) => setPolicyText(event.target.value)}
                  spellCheck={false}
                />
              </label>
            </div>
          )}
        </div>

        <label htmlFor="sim-events">
          <div>
            <h2>Event Stream (JSONL)</h2>
            <p>Replay tool-call events and inspect deterministic findings plus anomaly-driven escalations.</p>
          </div>
          <textarea
            id="sim-events"
            value={eventsText}
            onChange={(event) => setEventsText(event.target.value)}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="simulator-toolbar">
        <button type="button" onClick={runSimulation} disabled={isRunning}>
          {isRunning ? "Running…" : "Run Simulation"}
        </button>

        <div className="simulator-playback">
          <button type="button" onClick={togglePlayback} disabled={results.length === 0}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={stepPlayback} disabled={results.length === 0}>
            Step
          </button>
          <button type="button" onClick={resetPlayback} disabled={results.length === 0}>
            Reset
          </button>
          <label htmlFor="sim-playback-speed">
            Speed
            <select
              id="sim-playback-speed"
              value={String(playbackSpeedMs)}
              onChange={(event) => setPlaybackSpeedMs(Number(event.target.value))}
            >
              <option value="2000">Fast</option>
              <option value="3000">Normal</option>
              <option value="5000">Slow</option>
            </select>
          </label>
        </div>

        <div className="simulator-summary">
          <span className="summary-chip summary-chip--neutral">
            {summary.events} event{summary.events !== 1 ? "s" : ""}
          </span>
          {results.length > 0 && (
            <>
              <span className="summary-chip summary-chip--allow">{summary.allow} allow</span>
              <span className="summary-chip summary-chip--approval">{summary.require_approval} approval gate</span>
              <span className="summary-chip summary-chip--block">{summary.block} block</span>
              <span className="summary-chip summary-chip--neutral">avg anomaly {summary.avgAnomaly}</span>
            </>
          )}
        </div>
      </div>

      {error ? <p className="simulator-error">{error}</p> : null}

      <section className="simulator-log-panel" aria-label="Live test log">
        <h3>Live Log: What Was Tested</h3>
        {liveLog.length === 0 ? (
          <p className="simulator-log-panel__empty">Run simulation to stream event-by-event evaluation logs.</p>
        ) : (
          <ol className="simulator-log-list">
            {liveLog.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ol>
        )}
      </section>

      <div className="simulator-results">
        {results.length === 0 && !error ? (
          <p className="simulator-empty">Run a simulation to see per-event decisions and findings here.</p>
        ) : (
          results.map((entry) => (
            <article
              key={entry.index}
              className={`decision-card decision-${entry.result.decision}${entry.index === activeResultIndex ? " decision-card--active" : ""}`}
              onClick={() => {
                setIsPlaying(false);
                setIsStepping(false);
                setActiveResultIndex(entry.index);
                setPlaybackToken((t) => t + 1);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setIsPlaying(false);
                  setIsStepping(false);
                  setActiveResultIndex(entry.index);
                  setPlaybackToken((t) => t + 1);
                }
              }}
            >
              <header>
                <strong>#{entry.index + 1}</strong>
                <span className={`decision-badge decision-badge--${entry.result.decision}`}>
                  {entry.result.decision.replace("_", " ")}
                </span>
                <span className={`execution-badge execution-badge--${entry.execution}`}>
                  {executionLabel(entry.execution)}
                </span>
                <span className="anomaly-chip">anomaly {entry.result.anomaly.score.toFixed(2)}</span>
              </header>

              {typeof entry.parsed.text === "string" ? (
                <p className="decision-command">{entry.parsed.text}</p>
              ) : (
                <p className="decision-raw">{entry.raw}</p>
              )}

              <ul>
                {entry.result.findings.length === 0 ? (
                  <li>No deterministic rule findings.</li>
                ) : (
                  entry.result.findings.map((finding) => (
                    <li key={`${entry.index}-${finding.ruleId}`}>
                      <strong>{finding.ruleId}</strong> — {finding.why}
                    </li>
                  ))
                )}
              </ul>

              {entry.result.anomaly.reasons.length > 0 ? (
                <p className="decision-anomaly">Anomaly: {entry.result.anomaly.reasons.join("; ")}</p>
              ) : null}

              <p className="decision-chain">
                Chain: <strong>{entry.result.chainOfCommand.status}</strong>
                {entry.chainEscalated ? " · escalated" : ""}
              </p>

              {entry.reviewReasons.length > 0 ? (
                <p className="decision-chain">Review: {entry.reviewReasons.join("; ")}</p>
              ) : null}

              {approvalReason(entry.parsed) ? (
                <p className="decision-chain">Approval: {approvalReason(entry.parsed)}</p>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
