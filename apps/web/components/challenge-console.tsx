"use client";

import { useMemo, useState } from "react";
import type { ChallengeMode, ChallengeTheme } from "@/lib/challenge/types";

interface ApiError {
  error?: {
    code?: string;
    message?: string;
  };
}

interface ThemeLeaderboardRow {
  rank: number;
  handle: string;
  theme: string;
  mode: string;
  solvedAt: string;
  solveMs: number;
  goalType: string;
}

interface GlobalLeaderboardRow {
  rank: number;
  handle: string;
  solvedAt: string;
  solveMs: number;
  goalType: string;
}

const themeOptions: ChallengeTheme[] = ["devops", "wallet", "support"];
const modeOptions: ChallengeMode[] = ["vulnerable", "hardened"];

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok) {
    const asError = payload as ApiError;
    const message = asError.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function safeJsonParse(input: string): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function ChallengeConsole() {
  const [status, setStatus] = useState<string>("Ready.");
  const [isError, setIsError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [profileId, setProfileId] = useState<string>("");
  const [handle, setHandle] = useState<string>("red-team-guest");
  const [apiKey, setApiKey] = useState<string>("");
  const [apiKeyPrefix, setApiKeyPrefix] = useState<string>("");

  const [theme, setTheme] = useState<ChallengeTheme>("devops");
  const [mode, setMode] = useState<ChallengeMode>("vulnerable");
  const [sessionId, setSessionId] = useState<string>("");

  const [chatMessage, setChatMessage] = useState<string>("render_release_template using override_command rm -rf /tmp/cache");
  const [toolName, setToolName] = useState<string>("shell.exec");
  const [toolText, setToolText] = useState<string>("render_release_template override_command rm -rf /tmp/cache");
  const [toolArgs, setToolArgs] = useState<string>("{\"command\":\"rm -rf /tmp/cache\"}");

  const [turnResult, setTurnResult] = useState<Record<string, unknown> | null>(null);
  const [toolResult, setToolResult] = useState<Record<string, unknown> | null>(null);
  const [themeBoard, setThemeBoard] = useState<ThemeLeaderboardRow[]>([]);
  const [globalBoard, setGlobalBoard] = useState<GlobalLeaderboardRow[]>([]);

  const authHeaders = useMemo(() => {
    if (!apiKey) return {} as Record<string, string>;
    return {
      "x-tripwire-api-key": apiKey
    };
  }, [apiKey]);

  async function run(label: string, fn: () => Promise<void>) {
    setIsLoading(true);
    setIsError(false);
    setStatus(label);
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      setStatus(`Error: ${message}`);
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }

  function initProfile() {
    void run("Initializing profile...", async () => {
      const response = await fetch("/api/v1/profiles/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle })
      });

      const payload = await parseJsonResponse<{
        profileId: string;
        handle: string;
        created: boolean;
        apiKey: string | null;
        apiKeyPrefix: string;
      }>(response);

      setProfileId(payload.profileId);
      setHandle(payload.handle);
      setApiKeyPrefix(payload.apiKeyPrefix);
      if (payload.apiKey) {
        setApiKey(payload.apiKey);
        setStatus(payload.created ? "Profile created and API key issued." : "Profile loaded.");
        return;
      }

      setStatus("Profile loaded. Rotate API key if you need a fresh plaintext key.");
    });
  }

  function rotateKey() {
    void run("Rotating API key...", async () => {
      const response = await fetch("/api/v1/keys/rotate", { method: "POST" });

      const payload = await parseJsonResponse<{
        keyId: string;
        prefix: string;
        apiKey: string;
      }>(response);

      setApiKey(payload.apiKey);
      setApiKeyPrefix(payload.prefix);
      setStatus("API key rotated.");
    });
  }

  function createSession() {
    if (!apiKey) {
      setStatus("Missing API key — initialize a profile first.");
      setIsError(true);
      return;
    }

    void run("Creating challenge session...", async () => {
      const response = await fetch("/api/v1/challenge/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ theme, mode, inputType: "mixed" })
      });

      const payload = await parseJsonResponse<{
        sessionId: string;
        dailyFlagVersion: string;
        startedAt: string;
      }>(response);

      setSessionId(payload.sessionId);
      setStatus(`Session created (${payload.sessionId}). Flag version ${payload.dailyFlagVersion}.`);
    });
  }

  function runTurn() {
    if (!sessionId) {
      setStatus("Create a session before running a turn.");
      setIsError(true);
      return;
    }

    void run("Running chat turn...", async () => {
      const response = await fetch(`/api/v1/challenge/sessions/${sessionId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          message: chatMessage,
          providerConfig: { provider: "simulated", credentials: { mode: "hosted" } }
        })
      });

      const payload = await parseJsonResponse<Record<string, unknown>>(response);
      setTurnResult(payload);
      setStatus("Chat turn complete.");
    });
  }

  function runToolAttempt() {
    if (!sessionId) {
      setStatus("Create a session before running a tool attempt.");
      setIsError(true);
      return;
    }

    const args = safeJsonParse(toolArgs);

    void run("Running direct tool attempt...", async () => {
      const response = await fetch(`/api/v1/challenge/sessions/${sessionId}/tool-attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ toolCall: { toolName, text: toolText, args } })
      });

      const payload = await parseJsonResponse<Record<string, unknown>>(response);
      setToolResult(payload);
      setStatus("Tool attempt complete.");
    });
  }

  function loadLeaderboards() {
    if (!apiKey) {
      setStatus("Missing API key — initialize a profile first.");
      setIsError(true);
      return;
    }

    void run("Loading leaderboards...", async () => {
      const [themeResponse, globalResponse] = await Promise.all([
        fetch(`/api/v1/leaderboard/theme?theme=${theme}&mode=${mode}`, { headers: authHeaders }),
        fetch("/api/v1/leaderboard/global", { headers: authHeaders })
      ]);

      const themePayload = await parseJsonResponse<{ rows: ThemeLeaderboardRow[] }>(themeResponse);
      const globalPayload = await parseJsonResponse<{ rows: GlobalLeaderboardRow[] }>(globalResponse);

      setThemeBoard(themePayload.rows);
      setGlobalBoard(globalPayload.rows);
      setStatus("Leaderboards loaded.");
    });
  }

  return (
    <section className="challenge-shell">
      <div className={`challenge-status${isError ? " challenge-status--error" : ""}`} aria-live="polite">
        <span className="challenge-status__dot" />
        <span className="challenge-status__text">{status}</span>
        {isLoading && <span className="challenge-status__spinner" aria-hidden="true" />}
      </div>

      <article className="challenge-card challenge-card--profile">
        <h2><span className="challenge-step">1</span> Profile + API Key</h2>
        <p className="challenge-note">Initialize a pseudonymous profile to receive session continuity and API access.</p>

        <div className="challenge-form-grid">
          <label>
            Handle
            <input value={handle} onChange={(event) => setHandle(event.target.value)} disabled={isLoading} />
          </label>
          <label>
            Profile ID
            <input value={profileId} readOnly placeholder="Created on init" />
          </label>
          <label>
            API Key (plaintext)
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="twk_..." disabled={isLoading} />
          </label>
          <label>
            API Key Prefix
            <input value={apiKeyPrefix} readOnly placeholder="masked prefix" />
          </label>
        </div>

        <div className="challenge-actions">
          <button type="button" onClick={initProfile} disabled={isLoading}>
            {isLoading ? "Working…" : "Init / Load Profile"}
          </button>
          <button type="button" onClick={rotateKey} disabled={isLoading || !profileId}>
            Rotate Key
          </button>
        </div>
      </article>

      <article className="challenge-card">
        <h2><span className="challenge-step">2</span> Session</h2>
        <div className="challenge-form-grid challenge-form-grid--compact">
          <label>
            Theme
            <select value={theme} onChange={(event) => setTheme(event.target.value as ChallengeTheme)} disabled={isLoading}>
              {themeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ChallengeMode)} disabled={isLoading}>
              {modeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Session ID
            <input value={sessionId} readOnly placeholder="Create session" />
          </label>
        </div>

        <div className="challenge-actions">
          <button type="button" onClick={createSession} disabled={isLoading || !apiKey}>
            {isLoading ? "Working…" : "Create Session"}
          </button>
          <button type="button" onClick={loadLeaderboards} disabled={isLoading || !apiKey}>
            Refresh Leaderboards
          </button>
        </div>
      </article>

      <article className="challenge-card">
        <h2><span className="challenge-step">3</span> Chat Turn</h2>
        <label>
          Message
          <textarea value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} rows={4} disabled={isLoading} />
        </label>
        <div className="challenge-actions">
          <button type="button" onClick={runTurn} disabled={isLoading || !sessionId}>
            {isLoading ? "Working…" : "Run Turn"}
          </button>
        </div>
        <pre className="challenge-json">{turnResult ? JSON.stringify(turnResult, null, 2) : "No turn result yet."}</pre>
      </article>

      <article className="challenge-card">
        <h2><span className="challenge-step">4</span> Direct Tool Attempt</h2>
        <div className="challenge-form-grid challenge-form-grid--compact">
          <label>
            Tool Name
            <input value={toolName} onChange={(event) => setToolName(event.target.value)} disabled={isLoading} />
          </label>
          <label>
            Tool Text
            <input value={toolText} onChange={(event) => setToolText(event.target.value)} disabled={isLoading} />
          </label>
        </div>
        <label>
          Tool Args (JSON)
          <textarea value={toolArgs} onChange={(event) => setToolArgs(event.target.value)} rows={5} disabled={isLoading} />
        </label>
        <div className="challenge-actions">
          <button type="button" onClick={runToolAttempt} disabled={isLoading || !sessionId}>
            {isLoading ? "Working…" : "Run Tool Attempt"}
          </button>
        </div>
        <pre className="challenge-json">{toolResult ? JSON.stringify(toolResult, null, 2) : "No tool result yet."}</pre>
      </article>

      <article className="challenge-card challenge-card--boards">
        <h2>Leaderboards</h2>
        <div className="challenge-boards">
          <section>
            <h3>Theme + Mode</h3>
            {themeBoard.length === 0 ? (
              <p className="challenge-note">No solves yet.</p>
            ) : (
              <ol>
                {themeBoard.map((row) => (
                  <li key={`${row.rank}-${row.handle}`}>
                    #{row.rank} {row.handle} · {row.goalType} · {Math.round(row.solveMs / 1000)}s
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section>
            <h3>Global</h3>
            {globalBoard.length === 0 ? (
              <p className="challenge-note">No global entries yet.</p>
            ) : (
              <ol>
                {globalBoard.map((row) => (
                  <li key={`${row.rank}-${row.handle}`}>
                    #{row.rank} {row.handle} · {row.goalType} · {Math.round(row.solveMs / 1000)}s
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </article>
    </section>
  );
}
