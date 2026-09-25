# Lithium Client

Lithium Client connects a Windows or Linux machine to a Lithium endpoint and
exposes local execution capabilities only inside explicitly configured
Workspace roots.

The repository contains the machine-side client only: enrollment, device
credential storage, connection/reconnect, Workspace announcements, filesystem,
process and terminal capabilities, local execution policy, packaging and tests.

## Releases

Supported release assets:

- **Windows x64** — `lithium-client-windows-x64.exe`
- **Linux x64** — `lithium-client-linux-x64.tar.gz`

Source development requires Bun. Direct `npx` / `bunx` installation is not a
supported distribution path yet.

## Security defaults

The default policy is fail-closed:

- Workspace roots must be configured explicitly.
- Executables are allowlisted.
- Full child-environment forwarding is disabled.
- Unsafe shell is disabled.
- Account passwords are used only during interactive enrollment.
- Device credentials are never stored in the JSON config.
- Windows protects the device credential with DPAPI CurrentUser.
- Linux stores the device credential in a private mode-0600 file.

The default endpoint is `https://ai.lithium.dev.br` and can be changed in the
local config.

## Windows

Download `lithium-client-windows-x64.exe` and run it in a terminal.

On first interactive run the Client enrolls the machine and stores only the
issued device credential.

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

The Linux archive contains:

- `lithium-node`
- `lithium-node.example.json`
- `lithium-client.service`
- `README-LINUX.md`

Recommended paths:

- executable: `/opt/lithium-client/lithium-node`
- config: `/etc/lithium-node/config.json`
- credential: `/var/lib/lithium-node/device-credential`
- service user: `lithium-node`

See `README-LINUX.md` in the release archive for enrollment, systemd and
Workspace hardening.

## Development

```bash
bun install
bun run verify
bun test
bun run typecheck
```

Run the Windows entrypoint from source:

```bash
bun src/client-entry.ts
```

Run the Linux entrypoint on Linux:

```bash
bun src/linux-node-entry.ts status
bun src/linux-node-entry.ts enroll
bun src/linux-node-entry.ts run
```

## Build

```bash
bun run build:windows
bun run build:linux
bun run checksums
```

Release artifacts are written to `dist/`.

## Configuration

Windows starts from `lithium-client.example.json`.

Linux starts from `deploy/linux-node/lithium-node.example.json`.

Configuration contains only endpoint and local execution policy. Do not put an
account password, device credential, API key, signed URL or private key in a
config file.

## Repository scope

Keep this repository machine-local. Runtime source belongs to the Client,
device protocol, terminal/process execution and OS-specific credential/storage
helpers. Central application code, databases, deployment state and operator
credentials do not belong here.

See `SECURITY.md` and `CONTRIBUTING.md`.

## License

No open-source license has been granted yet. See `LICENSE.md`.
