import type {
  ChainOfCommandReviewRequest,
  ChainOfCommandReviewResponse,
  GuardDecisionResult,
  GuardEngine
} from "../types/index.js";

export interface LangChainToolCall {
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

export interface LangChainMiddlewareOptions {
  actorId?: string;
  sessionId?: string;
  actorType?: string;
  onRequireApproval?: (
    result: GuardDecisionResult,
    toolCall: LangChainToolCall
  ) => Promise<boolean> | boolean;
  onChainOfCommandReview?: (
    request: ChainOfCommandReviewRequest<LangChainToolCall>
  ) => Promise<ChainOfCommandReviewResponse> | ChainOfCommandReviewResponse;
}

export type LangChainMiddlewareNext<TRequest, TResponse> = (request: TRequest) => Promise<TResponse>;

export function langchainMiddleware(guard: GuardEngine, options: LangChainMiddlewareOptions = {}) {
  return async function middleware<TRequest extends { toolCall: LangChainToolCall }, TResponse>(
    request: TRequest,
    next: LangChainMiddlewareNext<TRequest, TResponse>
  ): Promise<TResponse> {
    const call = request.toolCall;
    const wrapped = guard.wrapTool<TRequest, TResponse>(
      call.toolName,
      async (inputRequest) => next(inputRequest),
      {
        buildContext: (inputRequest) => ({
          args: inputRequest.toolCall.args,
          text: inputRequest.toolCall.text,
          intent: inputRequest.toolCall.intent,
          destination: inputRequest.toolCall.destination,
          actorId: options.actorId,
          actorType: options.actorType ?? "agent",
          sessionId: options.sessionId,
          metadata: inputRequest.toolCall.metadata
        }),
        onRequireApproval: options.onRequireApproval
          ? async (result, inputRequest) => options.onRequireApproval!(result, inputRequest.toolCall)
          : undefined,
        onChainOfCommandReview: options.onChainOfCommandReview
          ? async (reviewRequest) =>
              options.onChainOfCommandReview!({
                ...reviewRequest,
                input: reviewRequest.input.toolCall
              })
          : undefined
      }
    );

    return wrapped(request);
  };
}

export function createLangChainToolWrapper(guard: GuardEngine, options: LangChainMiddlewareOptions = {}) {
  const approval = options.onRequireApproval;
  const chainReview = options.onChainOfCommandReview;

  return function wrapTool<TInput, TOutput>(
    toolName: string,
    toolFn: (input: TInput, guardResult: GuardDecisionResult) => Promise<TOutput> | TOutput
  ) {
    return guard.wrapTool(toolName, toolFn, {
      buildContext: (input) => ({
        actorId: options.actorId,
        sessionId: options.sessionId,
        actorType: options.actorType ?? "agent",
        args: input
      }),
      onRequireApproval: approval
        ? async (result, input) =>
            approval(result, {
              toolName,
              args: input
            })
        : undefined,
      onChainOfCommandReview: chainReview
        ? async (request) =>
            chainReview({
              ...request,
              input: {
                toolName,
                args: request.input
              }
            })
        : undefined
    });
  };
}
