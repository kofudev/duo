// Explicit local integration check: two real subscription requests, no filesystem writes by agents.
const { CodexProvider, ClaudeProvider } = require('../electron/providers.cjs');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.env.DUO_ALLOW_REAL_AI !== 'true')
    throw new Error('Real subscription checks require DUO_ALLOW_REAL_AI=true.');
  const project = path.resolve(__dirname, '..', '.cache', `live-team-${randomUUID()}`);
  fs.mkdirSync(project, { recursive: true });
  const codex = new CodexProvider({ turnTimeoutMs: 120000 });
  try {
    const models = await codex.models(),
      model = models.find((item) => item.default) || models[0];
    const checks = [];
    for (const [agent, provider, selected] of [
      ['codex', codex, model.id],
      ['claude', new ClaudeProvider(), 'haiku'],
    ]) {
      const proof = randomUUID();
      let invoked = 0,
        usage;
      const text = await provider.run({
        project,
        model: selected,
        effort:
          agent === 'codex'
            ? model.efforts.includes('low')
              ? 'low'
              : model.defaultEffort
            : undefined,
        write: false,
        commands: false,
        signal: AbortSignal.timeout(120000),
        onDelta: () => {},
        onTool: () => {},
        onUsage: (value) => {
          usage = value;
        },
        instructions:
          'Duo integration check. Call duo_probe once. Only this custom tool allowed. Do not inspect files, run commands, access parent directories, use other tools or spawn agents. Return JSON with received proof.',
        prompt: 'Call duo_probe. Return ONLY JSON {"proof":"exact returned proof"}.',
        outputSchema: {
          type: 'object',
          properties: { proof: { type: 'string' } },
          required: ['proof'],
          additionalProperties: false,
        },
        tools: [
          {
            name: 'duo_probe',
            description:
              'Returns one live shared-coordinator canary. Required for this integration check.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        ],
        onToolCall: (name) => {
          assert.equal(name, 'duo_probe');
          invoked++;
          return { proof };
        },
      });
      assert.ok(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')).proof.includes(proof));
      assert.equal(invoked, 1);
      checks.push({
        agent,
        model: selected,
        realToolCalls: invoked,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
      });
    }
    console.log(JSON.stringify({ passed: true, checks }));
  } finally {
    codex.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
