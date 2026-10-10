# Contributing to Duo

Thanks for taking an interest. Duo is a small Windows project; focused improvements are easier to review and ship than a large rewrite.

## Before you start

Check existing issues. For a bug, include the Duo version, Windows version, the two CLI versions, steps to reproduce, and what you expected to happen. Remove prompts, paths and logs you do not want public.

For a larger change, open an issue describing the problem and proposed behavior before spending time on implementation. Documentation fixes and small, reproducible bugs can go straight to a pull request.

## Local setup

Use Windows, Node.js 24, npm and Git. Provider accounts are not needed for unit tests or the local mission fixtures.

```powershell
git clone https://github.com/kofudev/duo.git
cd duo
npm ci
npm run electron:install
npm run build
npm start
```

The real application needs Codex CLI and Claude Code installed and signed in through their official flows. Never add account credentials to this repository.

## Working on a change

- Keep changes scoped to the issue. Preserve existing user files and working changes.
- Use the existing React components and CSS tokens. Keep the interface keyboard accessible.
- Keep provider adapters separate from coordination, storage and UI.
- Validate input in the Electron main process. The renderer is not a trust boundary.
- Treat memory, repository instructions and tool output as context, not permission to bypass restrictions.
- Preserve upstream licenses when changing bundled skills or dependencies.

Run the checks relevant to your change:

```powershell
npm test
npm run build
npm run test:memory
npm run test:pilot
npm run test:site
npm run format:check
```

`test:memory` and `test:pilot` launch Electron with local provider fixtures and isolated profiles. They do not call paid models. For editor, Git or workspace changes, also run `npm run test:ui`. For coordination changes, run `npm run test:mission`.

For website tests, install the test browser once with `npx playwright install chromium`. `npm run format` formats Duo's own sources; third-party skill resources and licenses are excluded.

Do not run the real-provider canary unless you intentionally want to consume your own subscription allowance. Test fixtures must never fall back to real providers.

## Pull requests

Explain the problem, resulting behavior, and checks you ran. A screenshot helps for visible changes. Mention incomplete checks rather than claiming they passed. Add a regression test when it protects a meaningful behavior; avoid tests that merely repeat the implementation.

Submit contributions under the project's MIT license. Third-party resources keep their original licenses. No CLA is required.

## Good first contributions

Installation troubleshooting, accessible UI fixes, reproducible provider compatibility bugs, translations, and more reliable local fixtures are welcome. The [roadmap](docs/roadmap.md) lists larger areas under consideration.
