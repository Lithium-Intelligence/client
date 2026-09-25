# Contributing

## Requirements

- Bun 1.3 or newer
- Git
- Windows for full Windows DPAPI/startup integration testing
- Linux for systemd/package acceptance

## Setup

```bash
bun install
bun run verify
bun test
bun run typecheck
```

## Boundaries

The client repository must not import Lithium Server, web UI, Project/Board/Card
domain services, TaskManager, server SQLite, or deployment credentials.

Machine execution remains local and policy-scoped. Keep unsafe shell disabled by
default and preserve Workspace path/executable restrictions.

## Pull requests

Before opening a pull request:

```bash
bun run verify
bun test
bun run typecheck
```

Build the relevant release target when changing packaging:

```bash
bun run build:windows
bun run build:linux
```
