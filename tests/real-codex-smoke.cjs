// Opt-in manual integration check. One real model request consumes ChatGPT quota.
const { CodexProvider } = require('../electron/providers.cjs');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.env.DUO_ALLOW_REAL_AI !== 'true')
    throw new Error(
      'Set DUO_ALLOW_REAL_AI=true only when a real subscription request is authorized.'
    );
  const provider = new CodexProvider({ turnTimeoutMs: 120000 }),
    project = path.resolve(__dirname, '..', '.cache', `live-codex-${randomUUID()}`),
    proof = randomUUID();
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'canary.txt'), proof);
  fs.writeFileSync(
    path.join(project, 'AGENTS.md'),
    'Only read canary.txt. Never modify files or access parent directories.'
  );
  let usage;
  const tools = [];
  try {
    const models = await provider.models(),
      model = models.find((m) => m.default) || models[0];
    const report = await provider.run({
      prompt:
        'Read canary.txt from current directory using a read-only filesystem tool. Return ONLY JSON {"proof":"exact content of canary.txt"}. Do not run project code or modify files.',
      instructions:
        'Duo integration check. Read only current project files. Read-only inspection commands permitted. Never modify files, run project scripts, install packages or access parent directories. No subagents.',
      project,
      model: model.id,
      effort: model.efforts.includes('high') ? 'high' : model.defaultEffort,
      write: false,
      signal: new AbortController().signal,
      onDelta: () => {},
      onTool: (name, detail) => tools.push({ name, detail }),
      onUsage: (value) => {
        usage = value;
      },
    });
    const result = JSON.parse(report.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    assert.equal(result.proof, proof);
    assert.equal(fs.readFileSync(path.join(project, 'canary.txt'), 'utf8'), proof);
    assert.ok(tools.length > 0);
    console.log(
      JSON.stringify({
        passed: true,
        realProvider: 'codex',
        model: model.id,
        readOnly: true,
        inspectionTools: tools.map((t) => t.name),
        tokens: usage?.totalTokens || null,
        project,
      })
    );
  } finally {
    provider.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
