# Validation

## Measured consumption and shorter handoffs · 0.5.1

- 133 unit tests passed. Economy fixtures complete two writes and mandatory partner reviews in five calls, with a local assembled report; no AI synthesis call is launched. Persisted work already reviewed can finish its local report without requesting quota or inference.
- A long-report fixture verifies that later writers and reviewers retain original objective, acceptance criteria and the report's final validation warning without repeating the full report. Interrupted token reports retain known cache fields and conservative token accounting.
- Native Windows fixtures passed both the ten-call full workflow and five-call economy workflow, including the consumption panel, actual file writes, reviews, restart, wrong-folder recovery, cancellation and no renderer errors.
- The packaged 0.5.1 application passed startup, model catalog and bundled skill checks, 246 dependency notices and an actual file save. The installer was built; runtime checks used its packaged executable, without installing over an existing user copy.
- The [public 0.5.1 release workflow](https://github.com/kofudev/duo/actions/runs/38079159617) passed Windows build, native mission and SSH checks, artifact verification and website deployment. Downloaded source and site archives passed checksum and CRC checks and show 0.5.1 without JavaScript. The live manifest matches the published artifact; the permanent installer link returns an executable.
- No live A/B token savings or quality comparison has been performed for this optimization. The 0.5.0 live measurements below include cached tokens and do not establish superiority over a single agent. See [measurement guide](economie.fr.md).

## Mission continuity and SSH · 0.5.0

- 130 unit tests passed, including cumulative resumption budgets, legacy plan migration, review resumption without repeating a writer, human blockers, real partner dispatch, recursive-consultation rejection and cancellation locks.
- Native mission fixtures verified that waiting survives reload, CONTINUE spends no additional inference while blocked, and selecting the correct existing folder preserves mission objective and build mode. Observed file changes were displayed independently of model reports.
- Codex (`gpt-6.1-sol`) and Claude (`haiku`) each completed one live custom-tool call with a canary returned by the coordinator and a structured response. A subsequent isolated live construction produced `alpha.mjs` and `beta.mjs` with one writer per provider. Claude read the actual first file during consultation and approved it during review. Importing the second module returned the expected `DUO_LIVE_A_B` value. The mission paused when the Codex quota reached its 20% reserve, before the second task's mandatory review; full live mission completion remains unvalidated. No quota override was used.
- Native SSH management passed create/select/test/edit/delete workflows, readonly defaults and zero reported axe violations in its modal. The connection-test response in this UI fixture is local and does not contact a server.
- A real OpenSSH readonly probe succeeded on Unix with Python 3.13.5. Four helper tests passed on that server in temporary directories: actual create/read/replace, stale-hash rejection, traversal/symlink/hardlink/secret protections, literal filenames, command exit codes, timeout and bounded output.

The packaged application also passed SSH management, the actual MCP bridge as a child Node process, resource checks and a real file save. Release checks repeat these workflows before publication. These checks do not guarantee model quality or accessibility for every user.

The public 0.5.0 release workflow passed Windows construction, unit and native integration checks, Unix helper checks, artifact verification and website deployment. The live site manifest matches the published versioned installer and portable hashes; the permanent installer URL returns an executable attachment.

## Logo update · 0.4.2

- 113 unit tests passed. Production dependency audit reported no known vulnerabilities.
- Website browser checks passed at 320–1440 px with zero reported axe violations. All five provider images decoded successfully from local assets.
- Native Electron checks passed for the welcome screen, connections, model catalog, project/workspace management and file editor. Codex, Claude and GitHub marks were visually checked in the connections dialog; both model tabs use the same assets.
- Native advanced checks also passed for Git worktrees, file conflict handling, skill editing, mission stop and restart persistence, using local CLI fixtures. The release workflow passed its packaged application and update-dialog checks.
- Website mission and social illustrations were regenerated from the updated page. Provider SVG paths and their recorded hashes are preserved; source notices accompany the installed application.

## First public release · 0.4.1

The 0.4.1 application was checked on Windows 11 x64 with Node.js 24 and Electron 44.4.1. The public release includes the 0.4 memory and duration features.

- 113 unit tests passed for provider protocols, files, Git, storage, quotas, scheduling, memory, skill path boundaries, update metadata and cross-platform release checksum validation.
- Native Electron memory tests passed for preview, editing, exclusion, import/export, duplication and persistence.
- A complete local-fixture mission made ten provider calls, showed both agents working, passed the same personal profile to both, wrote assigned files and completed partner reviews.
- The packaged application passed the same memory workflow, plus a real file save and resource checks.
- Pilotage checks covered optional time limits, strict quota blocking, pauses and scheduled work tied to its original project.
- Website browser checks passed at 320–1440 px, including downloads without JavaScript, command copying, keyboard tabs, the mobile menu, FAQ and reduced motion. The site made no third-party requests during the checks.
- Automated accessibility checks reported no violations on the new memory and import screens. Some contrast checks remained incomplete; this is not accessibility certification.

These coordination checks use local CLI fixtures. They do not establish quality, savings, or reliability across two live subscriptions. An earlier read-only Codex canary succeeded; a full live Codex + Claude mission has not been validated for this release. Reports from other accounts are welcome, with private data removed.

The Windows installer is unsigned. The installer workflow was exercised in the previous release; this application is checked as a packaged executable. Future releases should record installation, upgrade and uninstall results alongside runtime checks.

`npm audit --omit=dev` reported no known vulnerabilities in production dependencies when preparing this release. The complete development audit reported eight moderate dependency entries arising from the build toolchain's `sprintf-js` advisory, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The compatible audit-fix preview proposed no changes. This is recorded for maintainers; the package is not included in the application runtime. Audit results are a snapshot, not a guarantee that every dependency is safe.
