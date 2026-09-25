# Security

Do not post device credentials, account passwords, Workspace roots, private
repository contents or production configuration in public issues.

## Credential model

- Account passwords are used only for interactive enrollment and are not persisted.
- Windows stores the long-lived device credential using DPAPI CurrentUser.
- Linux stores the device credential in a private file that must remain mode 0600.
- JSON config contains endpoint and local execution policy only.

## Execution policy

The default configuration is fail-closed:

- `allowAllExecutables=false`
- `allowAllChildEnv=false`
- `enableUnsafeShell=false`

Only explicitly configured Workspace roots are exposed to remote execution.

## Reporting

Use GitHub private vulnerability reporting when available. Do not include a
working secret in a report. Use redacted examples and revoke any credential
that may have been exposed.
