# TripWire Rolepacks

Legacy rolepacks currently live in `rolepacks/*.json`.

TripWire v1 policy execution uses structured markdown policies (`.policy.md`), so legacy JSON rolepacks should be migrated with:

```bash
twire policy migrate --in rolepacks/dev.json --out rolepacks/dev.policy.md
```

## Safe evolution principles

- Keep policy changes explainable and deterministic.
- Treat policy updates like code changes with review + test fixtures.
- Roll out in stages (`monitor` -> `enforce`).
- Never silently downgrade `secrets`, `wallet`, or `irreversible` protections.

## Recommended workflow

1. Start from the closest existing rolepack.
2. Migrate to `.policy.md`.
3. Replay representative event logs with `twire replay`.
4. Tune false positives in monitor mode.
5. Move to enforce mode for production paths.
