# Third-party resources

Duo's own code and eight authored skills use the root MIT LICENSE. Third-party resources keep their separate licenses and attribution. Duo is an independent application, not an OpenAI, Anthropic or Vercel product.

## Bundled skills

| Resources                                                 | Upstream                                                                                                   | Exact snapshot                             | Original notices                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Caveman, Caveman Review, Caveman Commit, Ultracave        | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)                                          | `2e08b9177c07bb7249a8a2d1a6758e5db281d002` | Apache-2.0 LICENSE, LICENSE-MIT and README retained in each resource folder              |
| Frontend Design, Webapp Testing                           | [anthropics/skills](https://github.com/anthropics/skills)                                                  | `dbd4588f9e1033efb41dad4bef2f7947c8993d44` | Apache-2.0 LICENSE.txt retained                                                          |
| React Best Practices, Composition Patterns                | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)                                    | `063bee94c3f4df8453406c830b0a7df0f2860278` | MIT declaration and original README/SKILL.md retained; snapshot has no root LICENSE file |
| UI/UX Pro Max                                             | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)            | `50d8a7de0900119855614541f15a1a616691eb33` | Original MIT LICENSE, manifest, scripts and data retained                                |
| Memory Systems, Context Compression, Context Optimization | [Context Engineering Agent Skills](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | `58b55a8921758d13453b440704fb1b5b208c0b0e` | Original MIT LICENSE, manifests, references and scripts retained                         |

Copies live in this project's `resources` directory and the installed application's `resources/skills`. No global skill installation is performed. `resources/catalog.json` records per-skill provenance. Third-party skill bodies retain their upstream instructions; Duo supplies routing and permission boundaries separately.

## Application dependencies

`npm run notices` copies original license/notice files from installed production packages into `build/notices`. The installer includes them as `resources/licenses`; `index.json` records exact versions, package metadata and notice paths. This includes React, CodeMirror, Lucide, React Markdown, remark-gfm, YAML and their dependencies. IBM Plex Sans and JetBrains Mono retain their Fontsource-distributed SIL Open Font License files.

Electron's `LICENSE.electron.txt` and `LICENSES.chromium.html` accompany Duo.exe. Development tools remain subject to their package licenses and are not shipped as application runtimes.

`@anthropic-ai/claude-agent-sdk` **0.3.296** has an Anthropic license, not Duo's MIT license. Its original LICENSE.md and README.md are included in `resources/licenses`. See [Anthropic legal agreements](https://code.claude.com/docs/en/legal-and-compliance). Duo uses this SDK only to discover supported Claude Code model metadata and delegates actual inference to the separately installed, officially authenticated Claude CLI. The native SDK CLI packages are excluded from Duo's distribution.

The transitive `standardwebhooks` 1.1.1 package declares MIT but omits a license file. Its original npm metadata and the upstream Apache-2.0 LICENSE at the published gitHead are both retained, with provenance, in the generated notices. Sources: [published upstream revision](https://github.com/standard-webhooks/standard-webhooks/blob/b4d2c14fc5b4ccff3ff271e3b087dff812254c59/LICENSE), `build/license-sources/standardwebhooks-1.1.1/README.md`.
