# Lithium Node Linux headless

O Lithium Node é o executor local de capabilities em um host Linux. Ele roda como processo e identidade de sistema separados do Lithium Server web. O Server continua sendo a autoridade de Node/Workspace, ownership, autorização, routing e audit.

## Boundary

O processo `lithium-node` contém apenas:

- conexão Relay autenticada por `ldev_`;
- `DeviceRuntime` (filesystem/process/terminal);
- policy local de roots/executáveis/shell;
- anúncio de Workspaces e capabilities;
- heartbeat/reconnect.

Ele não contém Project, Board, Card, MCP Gateway central, painel web, SQLite da Platform ou `TaskManager`.

## Layout recomendado

- app: `/opt/lithium-client/lithium-node`
- config: `/etc/lithium-node/config.json`
- credential: `/var/lib/lithium-node/device-credential` (0600)
- workspace próprio: `/srv/lithium-node/workspaces`
- projetos opcionais: `/srv/projects`
- service: `lithium-client.service`
- user/group: `lithium-node:lithium-node`

O exemplo não expõe `/var/lib/lithium-server-pilot` por padrão. Banco, tokens e backups do Server central não devem virar Workspace acidentalmente.

## Instalação

```bash
id -u lithium-node >/dev/null 2>&1 || \
  useradd --system --home /var/lib/lithium-node --shell /usr/sbin/nologin lithium-node

install -d -o lithium-node -g lithium-node -m 0700 /var/lib/lithium-node
install -d -o lithium-node -g lithium-node -m 0750 /srv/lithium-node/workspaces
install -d -o lithium-node -g lithium-node -m 0750 /srv/projects
install -d -m 0755 /opt/lithium-client
install -d -m 0750 -o root -g lithium-node /etc/lithium-node

install -m 0755 lithium-node /opt/lithium-client/
install -m 0640 -o root -g lithium-node lithium-node.example.json /etc/lithium-node/config.json
install -m 0644 lithium-client.service /etc/systemd/system/
```

Revise `workspaceRoots`, executable allowlist e shell policy antes do enrollment.

## Enrollment

O caminho preferido é interativo no próprio host. A senha web é usada apenas para criar/obter a `ldev_` e não é persistida:

```bash
runuser -u lithium-node --preserve-environment -- \
  env LITHIUM_NODE_CONFIG_FILE=/etc/lithium-node/config.json \
      LITHIUM_NODE_CREDENTIAL_FILE=/var/lib/lithium-node/device-credential \
  /opt/lithium-client/lithium-node enroll
```

O arquivo final é gravado com mode 0600. O serviço não recebe a senha da conta.

Para provisioning automatizado, um secret store pode injetar `LITHIUM_DEVICE_CREDENTIAL` em uma execução one-shot. O Node persiste a credencial em 0600; remova a variável da automação depois. Não grave `ldev_` em unit, config, shell history, logs, board chat ou audit.

## Operação

```bash
systemctl daemon-reload
systemctl enable --now lithium-client.service
systemctl status lithium-client.service
journalctl -u lithium-client.service
```

Status sem revelar segredo:

```bash
runuser -u lithium-node --preserve-environment -- \
  env LITHIUM_NODE_CONFIG_FILE=/etc/lithium-node/config.json \
      LITHIUM_NODE_CREDENTIAL_FILE=/var/lib/lithium-node/device-credential \
  /opt/lithium-client/lithium-node status
```

## Hardening e Workspaces

A unit usa `ProtectSystem=strict`, `NoNewPrivileges`, capability set vazio, namespaces restritos e `ReadWritePaths` explícitos. Se adicionar um `workspaceRoot`, ajuste também a unit. Ter um root no JSON não deve ser usado para contornar a sandbox do systemd.

O Server recebe os roots pelo anúncio do Node, mas as tools públicas trabalham por `workspaceId`; o root físico não é exposto em `workspace_list/get`.

Unsafe shell fica desabilitado no exemplo. Habilitá-lo requer alteração explícita do config e continua sujeito ao routing/policy do Workspace no Server.

## Update e rollback

O Node é independente do Server:

1. pare somente `lithium-client.service`;
2. preserve o bundle anterior;
3. substitua `/opt/lithium-client/lithium-node`;
4. inicie o serviço;
5. confirme Node online e Workspaces anunciados no Server.

Rollback do Node não exige parar o Lithium Server nem modificar `platform.sqlite`.
