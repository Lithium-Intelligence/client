# Lithium Client

Lithium Client connects a Windows or Linux machine to Lithium Intelligence as a
local execution Node. The central Server remains the authority for identity,
Projects, Boards, Cards, Workspace routing, authorization and audit; the Client
only exposes machine-local capabilities inside configured Workspace roots.

## Supported distribution

The initial GitHub release surface is intentionally small and explicit:

- **Windows x64** — `lithium-client-windows-x64.exe`
- **Linux x64** — `lithium-client-linux-x64.tar.gz`

Direct `npx` / `bunx` install commands are not part of the supported release
contract yet. Source development requires Bun.

## Security model

Defaults are fail-closed:

- Workspace roots are explicit.
- Executables are allowlisted.
- Full child environment forwarding is disabled.
- Unsafe shell is disabled.
- Server credentials are not stored in config.
- Windows stores the device credential with DPAPI CurrentUser.
- Linux stores the device credential in a private 0600 file.

The default Server endpoint is `https://ai.lithium.dev.br`, but it can be
changed in the local config.

## Windows

Download `lithium-client-windows-x64.exe` from the latest GitHub release and
run it in a terminal.

On first interactive run it asks for your Lithium account credentials, registers
or reuses the computer, receives a device credential and stores only that
credential through DPAPI.

Useful commands:

```text
lithium-client-windows-x64.exe
lithium-client-windows-x64.exe status
lithium-client-windows-x64.exe configure
lithium-client-windows-x64.exe relink
lithium-client-windows-x64.exe logout
lithium-client-windows-x64.exe startup enable
lithium-client-windows-x64.exe startup disable
lithium-client-windows-x64.exe help
```

A local `lithium-client.json` is created next to the executable when missing.

## Linux

The Linux release contains a headless `lithium-node` executable plus:

- `lithium-node.example.json`
- `lithium-client.service`
- `README-LINUX.md`

The recommended system paths are:

- executable: `/opt/lithium-client/lithium-node`
- config: `/etc/lithium-node/config.json`
- credential: `/var/lib/lithium-node/device-credential`
- service user: `lithium-node`

See `README-LINUX.md` inside the release archive for enrollment, systemd and
Workspace hardening.

## Local development

```bash
bun install
bun run verify
bun test
bun run typecheck
```

Run the Windows source client:

```bash
bun src/client-entry.ts
```

Run the Linux source entrypoint on Linux:

```bash
bun src/linux-node-entry.ts status
bun src/linux-node-entry.ts enroll
bun src/linux-node-entry.ts run
```

## Build

Windows:

```bash
bun run build:windows
```

Linux:

```bash
bun run build:linux
```

Release checksums:

```bash
bun run checksums
```

Release output is written to `dist/`.

## Configuration

Start from `lithium-client.example.json` on Windows or
`deploy/linux-node/lithium-node.example.json` on Linux.

The config contains only Server endpoint and local machine policy. Never put an
account password, `ldev_...`, MCP token, API key or signed URL into config.

## Repository boundary

This repository intentionally excludes:

- Lithium Server implementation
- web/admin UI
- Project/Board/Card services
- server databases and backups
- TaskManager / internal agent boards
- production credentials

See `SECURITY.md` and `CONTRIBUTING.md`.

## License

No open-source license has been granted yet. See `LICENSE.md`. Decide the
intended license before making the repository public.
