# @tripwire/mesh-plugin (stub)

This is a **minimal adapter** to use Tripwire as a *framework* with **Mesh as an application plugin**.

- Tripwire: evaluates events → findings
- This package: maps findings → `allow | require_approval | deny`
- Mesh: wraps real capabilities and enforces the decision

## Usage

```js
import fs from 'node:fs';
import { wrapCapability } from '@tripwire/mesh-plugin';

const rulepack = JSON.parse(fs.readFileSync('rolepacks/wallet.json','utf8'));

const sendTx = async ({ args }) => {
  // your real Mesh capability call
  return { ok: true, tx: args };
};

const wrapped = wrapCapability({
  rulepack,
  capability: 'wallet_sign',
  toolFn: sendTx,
  buildEvent: ({ intent, args }) => ({
    ts: new Date().toISOString(),
    kind: 'tool_call',
    tool: 'wallet_sign',
    text: intent ?? JSON.stringify(args),
    meta: { args },
  }),
});

await wrapped({
  intent: 'send 20 ADA to addr1...'
  ,args: { amount: 20, to: 'addr1...' },
  approve: async ({ result }) => {
    console.log('needs approval:', result.findings);
    return false; // deny by default in this example
  }
});
```

## Next

- add a proper Mesh event schema mapping (tool args, costs, destinations)
- add an audit log sink interface
- add first-class `require_approval` severity tier in rulepacks
