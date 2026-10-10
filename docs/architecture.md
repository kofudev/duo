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

| Area                                              | Entry points                                          |
| ------------------------------------------------- | ----------------------------------------------------- |
| Startup and IPC                                   | `electron/main.cjs`, `electron/preload.cjs`           |
| Provider protocols and subprocess lifecycle       | `electron/providers.cjs`, `electron/process.cjs`      |
| Mission phases, task ownership and partner review | `electron/orchestrator.cjs`                           |
| Mission and rolling-day usage safeguards          | `electron/budget.cjs`                                 |
| Notes, retrieval and memory import/export         | `electron/memory.cjs`, `electron/memory-transfer.cjs` |
| Projects, workspaces, sessions and migrations     | `electron/library.cjs`, `electron/storage.cjs`        |
| Planned starts                                    | `electron/scheduler.cjs`                              |
| File access and review evidence                   | `electron/files.cjs`, `electron/review-evidence.cjs`  |
| Git and repository setup                          | `electron/git.cjs`, `electron/git-projects.cjs`       |
| Skill discovery and routing                       | `electron/skills.cjs`                                 |

## Coordination

Discussion mode collects two proposals and returns a synthesis. Complete coordination adds configured rounds of cross discussion. In build mode, the coordinator creates a structured plan, assigns tasks, lets one provider write at a time, and asks the other provider to review the declared files. A failed review gets at most one correction attempt before stopping for attention.

The review includes bounded file snapshots and hashes. An agent's approval is not proof that tests passed. The UI keeps author, phase, tool invocations, task state and reported validation visible.

## Context and state

Personal memory belongs to the local Duo profile. Project memory belongs to a project. Both are selected locally by relevance and pins, then included in the same base context sent to each provider. No extra model call is used to parse imports or create checkpoints.

History is saved atomically with recovery snapshots. Schema 4 preserves earlier project notes and creates a backup when migrating. Older Duo versions must not overwrite a newer schema.

## Testing

Unit tests exercise filesystem boundaries, provider protocols, quota behavior, migrations and coordination. Native Electron smoke tests use isolated profiles. Mission fixtures implement local CLI protocols and never contact model services. Tests using real accounts are explicit opt-in and can consume allowance.
