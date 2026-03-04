import { InMemoryRateLimitStore } from "../stores.js";
import { prescreenWebhookRequest } from "../prescreen.js";
import type { CreateNextWebhookHandlerOptions, NextWebhookAcceptedResponse } from "../types.js";

interface NextRouteContext {
  params: Promise<Record<string, string>> | Record<string, string>;
}

export function createNextWebhookHandler(options: CreateNextWebhookHandlerOptions) {
  const paramName = options.paramName ?? "id";
  const rateLimitStore = options.rateLimitStore ?? new InMemoryRateLimitStore();

  return async function nextWebhookHandler(request: Request, context: NextRouteContext): Promise<Response> {
    const params = await context.params;
    const botId = params[paramName] ?? "";
    const bodyBuffer = Buffer.from(await request.arrayBuffer());
    const xForwardedFor = request.headers.get("x-forwarded-for");
    const xRealIp = request.headers.get("x-real-ip");

    const prescreen = await prescreenWebhookRequest({
      method: request.method,
      botId,
      rawBody: bodyBuffer,
      contentType: request.headers.get("content-type"),
      clientIp: xForwardedFor ?? xRealIp,
      config: options.config,
      rateLimitStore
    });

    if (!prescreen.ok) {
      return Response.json(
        {
          status: "rejected",
          reason: prescreen.reason,
          detail: prescreen.detail
        },
        { status: prescreen.status }
      );
    }

    try {
      const result = await options.onAccepted({
        request,
        accepted: prescreen.accepted
      });

      return asResponse(result);
    } catch (error) {
      return Response.json(
        {
          status: "error",
          detail: error instanceof Error ? error.message : "next-handler-error"
        },
        { status: 500 }
      );
    }
  };
}

function asResponse(result: NextWebhookAcceptedResponse): Response {
  if (result instanceof Response) {
    return result;
  }

  if (!result) {
    return Response.json({ status: "accepted" }, { status: 202 });
  }

  return Response.json(result.body ?? { status: "accepted" }, {
    status: result.status ?? 202,
    headers: result.headers
  });
}
