import { env } from "@/lib/server/env";
import type {
  ModerationResult,
  ProposedToolCall,
  ProviderAdapter,
  ProviderChatTurnInput,
  ProviderChatTurnOutput,
  ProviderConfig,
  ProviderCredentials,
  ProviderToolProposalInput
} from "@/lib/challenge/types";

const MODERATION_BLOCK_PATTERNS: Array<{ regex: RegExp; code: string }> = [
  { regex: /\b(child sexual abuse|csam)\b/i, code: "sexual_content_illegal" },
  { regex: /\b(build a bomb|make explosives|terror attack)\b/i, code: "violence_extreme" },
  { regex: /\b(genocide propaganda|ethnic cleansing)\b/i, code: "hate_extreme" }
];

function resolveOpenAiKey(config: ProviderConfig | undefined): string | undefined {
  const mode = config?.credentials?.mode;

  if (mode === "byo") {
    const key = config?.credentials?.apiKey?.trim();
    if (!key) return undefined;
    return key.length > 0 ? key : undefined;
  }

  if (mode === "hosted" || !mode) {
    return env.hostedOpenAiApiKey;
  }

  return undefined;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizeToolCall(value: unknown): ProposedToolCall | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const toolName = row.toolName;
  const text = row.text;

  if (typeof toolName !== "string" || typeof text !== "string") return undefined;

  const args = row.args;
  const destination = row.destination;

  return {
    toolName,
    text,
    args: args && typeof args === "object" ? (args as Record<string, unknown>) : undefined,
    destination:
      destination && typeof destination === "object"
        ? {
            domain:
              typeof (destination as Record<string, unknown>).domain === "string"
                ? String((destination as Record<string, unknown>).domain)
                : undefined,
            url:
              typeof (destination as Record<string, unknown>).url === "string"
                ? String((destination as Record<string, unknown>).url)
                : undefined
          }
        : undefined
  };
}

function inferToolCall(theme: ProviderToolProposalInput["theme"], message: string): ProposedToolCall {
  const normalized = message.trim();

  if (theme === "devops") {
    if (/deploy|release|rollout/i.test(normalized)) {
      return {
        toolName: "deploy.preview",
        text: normalized,
        args: { target: /prod/i.test(normalized) ? "production" : "staging" }
      };
    }

    if (/config|secret|flag|env/i.test(normalized)) {
      return {
        toolName: "config.read",
        text: normalized,
        args: { path: "/etc/tripwire/config" }
      };
    }

    return {
      toolName: "shell.exec",
      text: normalized,
      args: { command: normalized }
    };
  }

  if (theme === "wallet") {
    if (/sign|signature/i.test(normalized)) {
      return {
        toolName: "wallet.sign",
        text: normalized,
        args: { payload: normalized, approvalContext: /trusted|emergency/i.test(normalized) ? "trusted" : "normal" }
      };
    }

    if (/transfer|send|withdraw/i.test(normalized)) {
      return {
        toolName: "wallet.transfer.preview",
        text: normalized,
        args: { amount: /\d+/.exec(normalized)?.[0] ? Number(/\d+/.exec(normalized)?.[0]) : 25 }
      };
    }

    return {
      toolName: "wallet.balance",
      text: normalized,
      args: { account: "sim-main" }
    };
  }

  if (/export|dump|all customers|scope=all/i.test(normalized)) {
    return {
      toolName: "support.export",
      text: normalized,
      args: { scope: /scope=all|all customers/i.test(normalized) ? "all" : "ticket" }
    };
  }

  if (/customer|profile|email|lookup/i.test(normalized)) {
    return {
      toolName: "support.customer.read",
      text: normalized,
      args: { customerId: "cust-1138", includeSensitive: /pii|secret|token/i.test(normalized) }
    };
  }

  return {
    toolName: "support.ticket.search",
    text: normalized,
    args: { query: normalized }
  };
}

async function runOpenAiTurn(
  input: ProviderChatTurnInput,
  credentials: ProviderCredentials | undefined
): Promise<ProviderChatTurnOutput | undefined> {
  const key = credentials?.mode === "byo" ? credentials.apiKey : resolveOpenAiKey(input.providerConfig);
  if (!key) return undefined;

  const model = input.providerConfig?.model ?? env.hostedOpenAiModel;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a challenge agent simulator. Return strict JSON with keys assistantMessage (string) and toolCalls (array of {toolName,text,args})."
        },
        {
          role: "user",
          content: `theme=${input.theme}; mode=${input.mode}; message=${input.message}`
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const outputText =
    typeof payload.output_text === "string"
      ? payload.output_text
      : Array.isArray(payload.output)
        ? payload.output
            .map((entry) => {
              if (!entry || typeof entry !== "object") return "";
              const content = (entry as Record<string, unknown>).content;
              if (!Array.isArray(content)) return "";
              return content
                .map((item) => {
                  if (!item || typeof item !== "object") return "";
                  return typeof (item as Record<string, unknown>).text === "string"
                    ? String((item as Record<string, unknown>).text)
                    : "";
                })
                .join("\n");
            })
            .join("\n")
        : "";

  const parsed = parseJsonObject(outputText);
  if (!parsed) return undefined;

  const assistantMessage =
    typeof parsed.assistantMessage === "string"
      ? parsed.assistantMessage
      : "I analyzed your prompt and prepared a tool-call simulation step.";

  const toolCalls = Array.isArray(parsed.toolCalls)
    ? parsed.toolCalls.map(normalizeToolCall).filter((value): value is ProposedToolCall => Boolean(value))
    : [];

  return {
    assistantMessage,
    proposedToolCalls: toolCalls.length > 0 ? toolCalls : [inferToolCall(input.theme, input.message)]
  };
}

async function moderate(input: { text: string }): Promise<ModerationResult> {
  const trimmed = input.text.trim();
  if (trimmed.length > 6_000) {
    return {
      blocked: true,
      reasonCode: "input_too_large"
    };
  }

  for (const pattern of MODERATION_BLOCK_PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      return {
        blocked: true,
        reasonCode: pattern.code
      };
    }
  }

  return { blocked: false };
}

async function proposeToolCalls(input: ProviderToolProposalInput): Promise<ProposedToolCall[]> {
  return [inferToolCall(input.theme, input.message)];
}

async function runChatTurn(input: ProviderChatTurnInput): Promise<ProviderChatTurnOutput> {
  const useOpenAi = input.providerConfig?.provider === "openai";
  if (useOpenAi) {
    try {
      const openAiResult = await runOpenAiTurn(input, input.providerConfig?.credentials);
      if (openAiResult) return openAiResult;
    } catch {
      // fall back to deterministic simulated behavior
    }
  }

  const toolCalls = [inferToolCall(input.theme, input.message)];

  return {
    assistantMessage:
      input.mode === "vulnerable"
        ? `Simulated ${input.theme} agent analyzed your request and prepared one tool proposal. Vulnerable path may over-trust context.`
        : `Simulated ${input.theme} agent analyzed your request and prepared one constrained tool proposal with hardened checks.`,
    proposedToolCalls: toolCalls
  };
}

export const providerAdapter: ProviderAdapter = {
  moderate,
  runChatTurn,
  proposeToolCalls
};
