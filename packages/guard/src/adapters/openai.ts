import type {
  ChainOfCommandReviewRequest,
  ChainOfCommandReviewResponse,
  GuardDecisionResult,
  GuardEngine,
  ToolCallContext,
  WrapToolOptions,
  WrappedToolFn
} from "../types/index.js";

export interface OpenAIAdapterOptions {
  actorId?: string;
  sessionId?: string;
  actorType?: string;
  onRequireApproval?: (result: GuardDecisionResult, toolCall: OpenAIToolCall) => Promise<boolean> | boolean;
  onChainOfCommandReview?: (
    request: ChainOfCommandReviewRequest<OpenAIToolCall>
  ) => Promise<ChainOfCommandReviewResponse> | ChainOfCommandReviewResponse;
}

export interface OpenAIToolCall {
  toolName: string;
  args?: unknown;
  text?: string;
  intent?: string;
  destination?: {
    domain?: string;
    url?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface OpenAIGuardrailHookInput {
  tool_name: string;
  tool_input?: unknown;
  run_context?: Record<string, unknown>;
}

export function openaiAdapter(guard: GuardEngine, options: OpenAIAdapterOptions = {}) {
  return {
    async beforeToolExecution(toolCall: OpenAIToolCall): Promise<GuardDecisionResult> {
      const context: ToolCallContext = {
        toolName: toolCall.toolName,
        args: toolCall.args,
        text: toolCall.text,
        intent: toolCall.intent,
        destination: toolCall.destination,
        actorId: options.actorId,
        actorType: options.actorType ?? "agent",
        sessionId: options.sessionId,
        metadata: toolCall.metadata
      };

      return guard.beforeToolCall(context);
    },

    wrapTool<TInput, TOutput>(
      toolName: string,
      toolFn: (input: TInput, guardResult: GuardDecisionResult) => Promise<TOutput> | TOutput,
      opts: WrapToolOptions<TInput> = {}
    ): WrappedToolFn<TInput, TOutput> {
      return guard.wrapTool(toolName, toolFn, {
        ...opts,
        onRequireApproval: async (result, input) => {
          if (opts.onRequireApproval) {
            return opts.onRequireApproval(result, input);
          }

          if (!options.onRequireApproval) return false;

          const payload: OpenAIToolCall = {
            toolName,
            args: input,
            text: undefined,
            intent: undefined
          };

          return options.onRequireApproval(result, payload);
        },
        onChainOfCommandReview:
          opts.onChainOfCommandReview || options.onChainOfCommandReview
            ? async (request) => {
                if (opts.onChainOfCommandReview) {
                  return opts.onChainOfCommandReview(request);
                }

                const payload: OpenAIToolCall = {
                  toolName,
                  args: request.input,
                  text: undefined,
                  intent: undefined
                };

                return options.onChainOfCommandReview!({
                  ...request,
                  input: payload
                });
              }
            : undefined
      });
    },

    async guardrail(input: OpenAIGuardrailHookInput): Promise<GuardDecisionResult> {
      return guard.beforeToolCall({
        toolName: input.tool_name,
        args: input.tool_input,
        text: JSON.stringify(input.tool_input ?? {}),
        sessionId: options.sessionId,
        actorId: options.actorId,
        actorType: options.actorType ?? "agent",
        metadata: input.run_context
      });
    }
  };
}
