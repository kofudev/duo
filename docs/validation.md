# Validation for the first public release

The 0.4.1 application was checked on Windows 11 x64 with Node.js 24 and Electron 44.4.1. The public release includes the 0.4 memory and duration features.

- 111 unit tests passed for provider protocols, files, Git, storage, quotas, scheduling, memory, skill path boundaries and update metadata validation.
- Native Electron memory tests passed for preview, editing, exclusion, import/export, duplication and persistence.
- A complete local-fixture mission made ten provider calls, showed both agents working, passed the same personal profile to both, wrote assigned files and completed partner reviews.
- The packaged application passed the same memory workflow, plus a real file save and resource checks.
- Pilotage checks covered optional time limits, strict quota blocking, pauses and scheduled work tied to its original project.
- Website browser checks passed at 320–1440 px, including downloads without JavaScript, command copying, keyboard tabs, the mobile menu, FAQ and reduced motion. The site made no third-party requests during the checks.
- Automated accessibility checks reported no violations on the new memory and import screens. Some contrast checks remained incomplete; this is not accessibility certification.

These coordination checks use local CLI fixtures. They do not establish quality, savings, or reliability across two live subscriptions. An earlier read-only Codex canary succeeded; a full live Codex + Claude mission has not been validated for this release. Reports from other accounts are welcome, with private data removed.

The Windows installer is unsigned. The installer workflow was exercised in the previous release; this application is checked as a packaged executable. Future releases should record installation, upgrade and uninstall results alongside runtime checks.

`npm audit --omit=dev` reported no known vulnerabilities in production dependencies when preparing this release. The complete development audit reported eight moderate dependency entries arising from the build toolchain's `sprintf-js` advisory, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The compatible audit-fix preview proposed no changes. This is recorded for maintainers; the package is not included in the application runtime. Audit results are a snapshot, not a guarantee that every dependency is safe.
