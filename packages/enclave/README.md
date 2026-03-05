# @twire/enclave

Handle-only key custody and wallet plugin runtime for TripWire.

## Goals

- Keep key material non-exportable from the package API.
- Support relay-style HMAC signing through opaque handles.
- Support pluggable chain wallets behind a unified interface.

## Install

```bash
npm i @twire/enclave
```

## Quickstart

```ts
import { createEnclave } from "@twire/enclave";
import { createMeshCardanoWalletPlugin } from "@twire/enclave/adapters/mesh-cardano";
import { createMeshBitcoinWalletPlugin } from "@twire/enclave/adapters/mesh-bitcoin";

const enclave = createEnclave();
enclave.registerWalletPlugin(createMeshCardanoWalletPlugin());
enclave.registerWalletPlugin(createMeshBitcoinWalletPlugin());

const secret = await enclave.generateSecret();
const sig = await enclave.signHmacHex({
  handleId: secret.id,
  data: "hello"
});
```

## Security Notes

- `@twire/enclave` never exposes private keys or secret plaintext after import/generation.
- The default in-memory provider is intended for development and tests.
- For production persistence and stronger host isolation, provide an external provider implementation.

## Mesh adapters

Initial adapters are exported as subpaths:

- `@twire/enclave/adapters/mesh-cardano`
- `@twire/enclave/adapters/mesh-bitcoin`

These adapters are designed to fit the unified enclave wallet plugin contract.
