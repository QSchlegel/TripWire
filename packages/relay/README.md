# @twire/relay

Prescreened webhook utilities and a secure bot-runtime tunnel client for Bot Relay.

## Features

- HTTP long-poll runtime client (`createRelayRuntime`)
- Runtime-agnostic adapter runtime (`createRelayRuntimeWithAdapter`)
- Canonical HMAC verification (`verifyRelaySignature`)
- Nonce replay and idempotency stores (in-memory adapters included)
- Webhook prescreening (`prescreenWebhookRequest`)
- Next.js route adapter (`createNextWebhookHandler`)
- OpenClaw agent hook adapter (`createOpenClawAgentAdapter`)

## Install

```bash
npm i @twire/relay
```

## Runtime quick start

```ts
import { createRelayRuntime } from "@twire/relay";

const runtime = createRelayRuntime({
  relayUrl: process.env.TWIRE_RELAY_URL!,
  botId: process.env.TWIRE_BOT_ID!,
  sharedSecret: process.env.TWIRE_RELAY_SECRET!
});

runtime.onDelivery(async (delivery) => {
  await delivery.verify();
  await handleEvent(delivery.event, delivery.payload, delivery.meta);
  await delivery.ack({ detail: "processed" });
});

await runtime.connect();
```

## Runtime-agnostic adapters

```ts
import { createOpenClawAgentAdapter, createRelayRuntimeWithAdapter } from "@twire/relay";

const openclaw = createOpenClawAgentAdapter({
  baseUrl: process.env.OPENCLAW_BASE_URL ?? "http://127.0.0.1:18789",
  token: process.env.OPENCLAW_HOOK_TOKEN!,
  wait: 0
});

const runtime = createRelayRuntimeWithAdapter(
  {
    relayUrl: process.env.TWIRE_RELAY_URL!,
    botId: process.env.TWIRE_BOT_ID!,
    sharedSecret: process.env.TWIRE_RELAY_SECRET!
  },
  openclaw
);

await runtime.connect();
```

OpenClaw adapter behavior:

- Calls `POST /hooks/agent?wait=0` with `x-openclaw-token` auth
- Sends a structured JSON envelope in `message`
- Returns relay ACK on OpenClaw `2xx`
- Returns relay NACK for non-`2xx` statuses and network failures

Default runtime endpoints:

- `/api/relay/runtime/pull`
- `/api/relay/runtime/ack`
- `/api/relay/runtime/nack`

## Prescreen quick start

```ts
import { prescreenWebhookRequest } from "@twire/relay";

const result = await prescreenWebhookRequest({
  method: "POST",
  botId: "wallet_0xabc123",
  rawBody: JSON.stringify({ event: "wallet.transfer", payload: { tx: "0x..." } }),
  contentType: "application/json",
  clientIp: "203.0.113.10"
});
```

## Security defaults

- Timestamp skew tolerance: `300s`
- Nonce TTL: `10m`
- Idempotency retention: `24h`

Canonical signature base string:

`METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + NONCE + "\n" + SHA256(BODY)`

## Smoke suites

- `npm run smoke:contract` (mock relay server, deterministic)
- `npm run smoke:live` (`SMOKE_MODE=local` or `SMOKE_MODE=hosted-public`)

Supported smoke env vars:

- `SMOKE_BASE_URL` (default `http://localhost:3000`, hosted default `https://bot-relay.com`)
- `SMOKE_MODE` (`contract | local | hosted-public`)
- `SMOKE_TIMEOUT_MS` (default `15000`)
- `SMOKE_SHARED_SECRET` (required for signed tunnel checks)
- `SMOKE_BOT_ID_PREFIX` (default `smoke-relay`)
- `SMOKE_REQUIRE_TUNNEL` (default `true` in local mode, `false` in hosted-public mode)
