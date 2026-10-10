# Duo

**One prompt. Codex and Claude, working on the same project.**

Duo is an independent Windows application that connects the official Codex and Claude Code CLIs. Give both agents a task, follow their discussion, then watch them divide the work and review each other's changes.

[Download for Windows](https://github.com/kofudev/duo/releases/latest) · [Français](README.fr.md) · [User guide](docs/usage.fr.md) · [Contribute](CONTRIBUTING.md)

![Duo collaboration example](website/assets/mission-example.png)

_Illustrative workflow from the website. The application shows provider messages and tool activity as they arrive._

## Install

1. Download **Duo-Setup-0.5.0.exe** from [Releases](https://github.com/kofudev/duo/releases/latest), or extract the complete portable ZIP. Windows x64 is required. This early release is unsigned.
2. Install the official [Codex CLI](https://learn.chatgpt.com/docs/cli) and [Claude Code](https://code.claude.com/docs/en/setup). Authenticate with `codex login` and `claude auth login` using accounts that include access to those tools.
3. Open Duo, refresh **Connexions**, choose a project and send your request. Start in **Discuter** to inspect the proposed approach before allowing changes.

Duo uses your CLI subscriptions. It does not import passwords, implement its own provider login, or unlock models your account cannot access. Git is needed for repository operations; GitHub CLI is optional for authenticated cloning and GitHub workflows. Node.js is needed when your installed CLI uses an npm launcher.

## What it does

- **Shared missions:** parallel proposals, cross discussion, an assigned plan and partner reviews. Only one agent writes at a time. An unresolved review pauses further work.
- **Visible activity:** streamed messages, live partner consultations, task ownership, observed file changes, command results and a Markdown export.
- **Continuity:** keep the original objective and resume the interrupted step. A missing user choice pauses the mission; bare CONTINUE does not spend more inference while waiting.
- **SSH targets:** share one explicit Unix server connection per project, with read-only defaults and separate file-write/command permissions. See the [SSH guide](docs/ssh.fr.md).
- **Project workspaces:** create or import folders, clone repositories, use isolated worktrees, edit files, inspect diffs and commit selected changes. Push requires confirmation.
- **Models and effort:** catalogs from installed tools, compatible effort levels and CLI upgrade requirements. Web chat catalogs can differ.
- **Skills:** 19 selectable skills, including Caveman, UI/UX Pro Max, accessibility, debugging and context engineering. Personal and project skills are supported; third-party licenses are retained.
- **Memory:** a shared personal profile plus separate project notes. Import selected text, Markdown or memory JSON after previewing it. Only a bounded, relevant selection goes into a mission; imports do not invoke an AI.
- **Budgets and scheduling:** optional duration, local call/token limits, provider quota reserves when available and a local schedule. Duo must stay open and Windows awake for scheduled work.

Economy mode is the default. Full mode adds discussion rounds. Two agents can help expose mistakes; additional calls also consume quota. Duo does not promise better results or savings for every task.

## Current limits

This is an early Windows release. Coordination has been tested with local CLI fixtures, including a complete ten-call mission and the packaged application's memory workflow. Live calls, partner inspection and file creation were verified with both Codex and Claude. The live construction paused at the configured quota reserve before its last review; full live mission completion remains unvalidated. See [validation details](docs/validation.md).

Claude account quotas are not exposed by this integration. Strict quota mode blocks when required quota data is unavailable. Local budgets and Codex reserves cannot guarantee that a shared account never reaches its limit: other applications and calls already in progress also consume usage.

Memories from ChatGPT or Claude's web apps need a manual, reviewed transfer. Duo does not automatically access those memories. Interactive terminals, multimodal attachments, cloud execution and a general connector marketplace are outside this release.

## Develop

Windows, Node.js 24 LTS, npm and Git:

```powershell
git clone https://github.com/kofudev/duo.git
cd duo
npm ci
npm start
```

```powershell
npm test             # Local protocol, storage, file, Git, budget and memory tests
npm run test:memory  # Native Electron workflow with local CLI fixtures
npm run test:site    # Website interactions and accessibility
npm run dist         # Windows installer and unpacked application
```

The UI tests need a current build. Website tests need Playwright Chromium (`npx playwright install chromium`). Real provider inference is opt-in and consumes your subscription quota. No provider credentials are required for unit tests.

The download website lives in `website/` and needs no application server. Run `npm run site:preview` locally. [Deployment instructions](docs/website.fr.md) cover ordinary file hosting.

## Contribute

Small, focused changes are welcome. [Open a bug report](https://github.com/kofudev/duo/issues/new/choose), propose an improvement, improve a guide or test the application on another account. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Privacy](docs/privacy.md) · [Security](SECURITY.md) · [Release process](docs/releasing.md)

## License

Duo's code and eight authored skills use the [MIT license](LICENSE). Bundled skills, fonts, Electron and other dependencies keep their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md). Duo is not affiliated with OpenAI or Anthropic.
