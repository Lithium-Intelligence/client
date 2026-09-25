# Contributing

## Requirements

- Bun 1.4 or newer
- Git
- Windows for full DPAPI/startup integration testing
- Linux for systemd/package acceptance

## Setup

```bash
bun install --frozen-lockfile
bun run verify
bun test
bun run typecheck
```

## Runtime boundary

Keep runtime changes machine-local:

- enrollment and device authentication;
- connection/protocol handling;
- Workspace announcements and local policy;
- filesystem/process/terminal capabilities;
- OS-specific credential storage;
- packaging and release tooling.

Do not introduce central application code, databases, deployment state or
operator credentials into this repository.

Unsafe shell must remain opt-in. Preserve Workspace path restrictions,
executable policy and credential redaction.

## Pull requests

Before opening a pull request:

```bash
bun run verify
bun test
bun run typecheck
```

When changing packaging, also build the affected target:

```bash
bun run build:windows
bun run build:linux
```
