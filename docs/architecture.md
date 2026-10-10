# How Duo fits together

Duo is an Electron application with a React renderer. It delegates model access to the official CLIs; it does not implement its own subscription login or scrape the web chat interfaces.

```text
React renderer
    │ restricted IPC bridge
Electron main process
    ├── Library / atomic JSON storage
    ├── Orchestrator / usage budgets / scheduler
    ├── Codex App Server adapter
    ├── Claude Code print adapter
    ├── Files / editor / watcher
    └── Git / GitHub CLI / skill resources
```

## Important modules

| Area                                              | Entry points                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| Startup and IPC                                   | `electron/main.cjs`, `electron/preload.cjs`                                     |
| Provider protocols and subprocess lifecycle       | `electron/providers.cjs`, `electron/process.cjs`                                |
| Mission phases, task ownership and partner review | `electron/orchestrator.cjs`                                                     |
| Mission and rolling-day usage safeguards          | `electron/budget.cjs`                                                           |
| Notes, retrieval and memory import/export         | `electron/memory.cjs`, `electron/memory-transfer.cjs`                           |
| Projects, workspaces, sessions and migrations     | `electron/library.cjs`, `electron/storage.cjs`                                  |
| Planned starts                                    | `electron/scheduler.cjs`                                                        |
| File access and review evidence                   | `electron/files.cjs`, `electron/review-evidence.cjs`                            |
| Git and repository setup                          | `electron/git.cjs`, `electron/git-projects.cjs`                                 |
| Skill discovery and routing                       | `electron/skills.cjs`                                                           |
| Shared tools and Claude MCP bridge                | `electron/team-tools.cjs`, `electron/tool-bridge.cjs`, `electron/mcp-proxy.cjs` |
| Observed mission changes                          | `electron/mission-evidence.cjs`                                                 |
| Explicit remote target                            | `electron/ssh.cjs`, `electron/ssh-remote.py`                                    |

## Coordination

Discussion mode collects two proposals and returns a synthesis. Complete coordination adds configured rounds of cross discussion. In build mode, the coordinator creates a structured plan, assigns tasks, lets one provider write at a time, and asks the other provider to review the declared files. A failed review gets at most one correction attempt before stopping for attention.

Both adapters expose the same team tools. A provider can inspect a bounded live board, send a visible message or synchronously consult the partner about actual files. Consultations are read-only, charged to the same mission budget, limited to three per task and cannot recursively consult another provider. Already-running partners are reported as busy. Cancellation keeps the mission lock until nested provider processes exit.

Plans and reviews request validated structured output. Missing user input has a separate `waiting_user` state: the coordinator does not run a correction or start the next task. A bare CONTINUE while waiting starts no inference. The selected folder can be corrected through a native directory picker before modifications, keeping the objective and build settings.

The review includes bounded file snapshots and hashes, supplemented by observed changes even when a plan omitted a file. An agent's approval is not proof that tests passed. A mission baseline stores hashes, never source contents; its recap shows created, modified and deleted files, with coverage limits and external edits disclosed. Command completion records distinguish reported exit codes from unknown outcomes.

Mission checkpoints persist original objective, clarifications, plan and each task's implement/review/correct/final-review cursor. Manual resumption skips completed tasks, resumes an interrupted review without repeating the writer and keeps cumulative call/token accounting. Interrupted implementation first needs inspection of partial work; non-idempotent remote actions are never assumed to have failed just because the connection closed. Restart does not automatically replay a mission.

Economy construction removes general conversation history after structured planning and sends compact task handoffs. Original objective, clarifications, acceptance criteria and actual file evidence remain available. Reports keep head and tail excerpts for later steps; complete reports remain in the conversation. `efficiency.cjs` assembles the final report locally, retaining peer review without another inference call. Full mode still requests an AI synthesis.

Up to 200 per-call telemetry entries preserve phase, selected model, request character counts and provider-reported token/cache fields, including interrupted calls. Cache is never deducted from raw token guards. The consumption panel shows missing data explicitly; it does not infer subscription cost or savings against a single agent.

## Context and state

Personal memory belongs to the local Duo profile. Project memory belongs to a project. Both are selected locally by relevance and pins, then included in the same base context sent to each provider. No extra model call is used to parse imports or create checkpoints.

History is saved atomically with recovery snapshots. Schema 5 retains mission checkpoints and SSH profile metadata, preserving earlier notes and making a migration backup. Older Duo versions must not overwrite a newer schema.

Claude's per-call MCP configuration is private and temporary. It starts a narrow stdio adapter with an ephemeral loopback capability token; the token is not passed in argv, browser-origin requests are rejected and the endpoint closes after the CLI exits. Codex uses experimental App Server dynamic tools with the same scoped handlers. Remote mutations require an explicitly selected SSH profile and write-phase permissions; arbitrary remote shell commands additionally require both connection and mission command permissions. See [SSH behavior](ssh.fr.md).

## Testing

Unit tests exercise filesystem boundaries, provider protocols, quota behavior, migrations and coordination. Native Electron smoke tests use isolated profiles. Mission fixtures implement local CLI protocols and never contact model services. Tests using real accounts are explicit opt-in and can consume allowance.
