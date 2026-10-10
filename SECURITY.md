# Security

Duo can ask coding agents to edit a local project and, when enabled, run commands. Treat it as a development tool with access to your files. Review generated changes before running, committing or publishing them.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/kofudev/duo/security/advisories/new). Include the affected version, reproduction steps, expected boundary and actual behavior. Please do not post credentials or a working exploit against another user's environment in a public issue.

If private reporting is unavailable, open an issue requesting a private reporting route without including exploit details.

Only the latest published version receives fixes during this early stage. There is no promised response time; reports will be reviewed as capacity permits.

## Boundaries

- Electron uses context isolation, a sandboxed renderer and a restricted IPC bridge.
- The main process validates IPC origin and filesystem operations.
- Agents work within the selected project. Writes are sequential and reviewed by the partner.
- Claude's inherited hooks and MCP configuration are disabled for Duo invocations. Codex's own project sandbox remains applicable.
- Commit and push are explicit user actions. Agents are instructed not to publish or change credentials.
- Memory imports are local data. An imported note grants no tool permissions.

These controls reduce risk; they do not make arbitrary generated code safe. CLI behavior, inherited project guidance and external changes still matter. More detail: [privacy and data](docs/privacy.md).
