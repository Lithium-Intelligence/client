# Source synchronization

This standalone repository was initially extracted from the Lithium Intelligence
monorepo at commit:

`5b682f05a49561490d0318b45ed9e2e0d939099f`

The runtime source boundary is intentionally limited to:

- `src/client-entry.ts`
- `src/linux-node-entry.ts`
- `src/client/**`
- `src/device/**`
- `src/terminal/**`
- `src/protocol/**`
- `src/linux-node/**`
- `src/platform/windows-dpapi.ts`
- `src/binary.ts`
- `src/executor.ts`
- `src/image.ts`
- `src/security.ts`
- `src/text-patch.ts`

Do not sync Server, web UI, Platform domain services, TaskManager, databases,
production configs or deployment credentials into this repository.

Until the Client becomes independently versioned as the canonical source,
changes should be ported deliberately and validated with:

```bash
bun run verify
bun test
bun run typecheck
bun run build:windows
bun run build:linux
```
