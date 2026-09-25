# Lithium Client — Linux headless node

The Linux client runs as a dedicated system process and exposes local
capabilities only inside configured Workspace roots.

It provides:

- authenticated connection using a device credential;
- filesystem, process and terminal capabilities;
- executable/root/shell policy;
- Workspace and capability announcements;
- heartbeat and reconnect.

## Recommended layout

- executable: `/opt/lithium-client/lithium-node`
- config: `/etc/lithium-node/config.json`
- credential: `/var/lib/lithium-node/device-credential`
- default Workspace: `/srv/lithium-node/workspaces`
- service: `lithium-client.service`
- user/group: `lithium-node:lithium-node`

Do not include application databases, backups, credentials or unrelated host
directories in `workspaceRoots`.

## Installation

```bash
id -u lithium-node >/dev/null 2>&1 || \
  useradd --system --home /var/lib/lithium-node --shell /usr/sbin/nologin lithium-node

install -d -o lithium-node -g lithium-node -m 0700 /var/lib/lithium-node
install -d -o lithium-node -g lithium-node -m 0750 /srv/lithium-node/workspaces
install -d -m 0755 /opt/lithium-client
install -d -m 0750 -o root -g lithium-node /etc/lithium-node

install -m 0755 lithium-node /opt/lithium-client/
install -m 0640 -o root -g lithium-node lithium-node.example.json /etc/lithium-node/config.json
install -m 0644 lithium-client.service /etc/systemd/system/
```

Review `workspaceRoots`, executable allowlist and shell policy before
enrollment.

## Enrollment

Interactive enrollment is preferred. The account password is used only during
enrollment and is not persisted.

```bash
runuser -u lithium-node --preserve-environment -- \
  env LITHIUM_NODE_CONFIG_FILE=/etc/lithium-node/config.json \
      LITHIUM_NODE_CREDENTIAL_FILE=/var/lib/lithium-node/device-credential \
  /opt/lithium-client/lithium-node enroll
```

The issued device credential is stored with mode 0600.

For automated provisioning, a secret store may inject
`LITHIUM_DEVICE_CREDENTIAL` for a one-shot enrollment/start. Remove the
environment variable after the credential has been persisted. Never place the
credential in config, the systemd unit, shell history or logs.

## Operation

```bash
systemctl daemon-reload
systemctl enable --now lithium-client.service
systemctl status lithium-client.service
journalctl -u lithium-client.service
```

Status without exposing the credential:

```bash
runuser -u lithium-node --preserve-environment -- \
  env LITHIUM_NODE_CONFIG_FILE=/etc/lithium-node/config.json \
      LITHIUM_NODE_CREDENTIAL_FILE=/var/lib/lithium-node/device-credential \
  /opt/lithium-client/lithium-node status
```

## Hardening

The supplied unit uses `ProtectSystem=strict`, `NoNewPrivileges`, an empty
capability set, restricted namespaces and explicit `ReadWritePaths`.

If a new Workspace root is added to config, update the unit sandbox
accordingly. A JSON root does not override systemd filesystem restrictions.

Unsafe shell is disabled in the example config and should remain disabled
unless explicitly required.

## Update and rollback

1. stop `lithium-client.service`;
2. preserve the current binary;
3. replace `/opt/lithium-client/lithium-node`;
4. start the service;
5. run `lithium-node status` and verify the connection.

Rollback by restoring the previous binary and restarting the service.
