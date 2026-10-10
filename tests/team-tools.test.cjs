const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createToolBridge } = require('../electron/tool-bridge.cjs');
const { teamTools } = require('../electron/team-tools.cjs');
const { runCommand } = require('../electron/process.cjs');
test('agent tool lists expose remote mutations only with explicit phase permissions', () => {
  const readonly = teamTools({ ssh: true });
  assert.ok(readonly.some((tool) => tool.name === 'duo_consult_partner'));
  assert.ok(readonly.some((tool) => tool.name === 'duo_ssh_read'));
  assert.ok(!readonly.some((tool) => tool.name === 'duo_ssh_write' || tool.name === 'duo_ssh_run'));
  assert.ok(
    teamTools({ ssh: true, write: true, commands: true }).some(
      (tool) => tool.name === 'duo_ssh_run'
    )
  );
});
test('local bridge refuses unauthenticated and browser-origin requests; MCP child returns real tool value', async () => {
  let calls = 0;
  const bridge = await createToolBridge(
    [
      {
        name: 'duo_team_status',
        description: 'Status',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    async () => {
      calls++;
      return { actual: 'shared-state-canary' };
    }
  );
  try {
    assert.equal((await fetch(bridge.url, { method: 'POST', body: '{}' })).status, 403);
    assert.equal(
      (
        await fetch(bridge.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${bridge.token}`, origin: 'https://example.invalid' },
          body: '{}',
        })
      ).status,
      403
    );
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'duo_team_status', arguments: {} },
      },
    ];
    const output = await runCommand(
      process.execPath,
      [path.resolve(__dirname, '../electron/mcp-proxy.cjs')],
      {
        timeout: 10000,
        env: { DUO_TOOL_ENDPOINT: bridge.url, DUO_TOOL_TOKEN: bridge.token },
        input: messages.map(JSON.stringify).join('\n') + '\n',
      }
    );
    const replies = output.trim().split('\n').map(JSON.parse);
    assert.equal(replies.find((item) => item.id === 1).result.protocolVersion, '2025-06-18');
    assert.equal(replies.find((item) => item.id === 2).result.tools[0].name, 'duo_team_status');
    assert.equal(
      JSON.parse(replies.find((item) => item.id === 3).result.content[0].text).actual,
      'shared-state-canary'
    );
    assert.equal(calls, 1);
    const denied = await fetch(bridge.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({ method: 'tools/call', name: 'unknown' }),
    });
    assert.equal((await denied.json()).isError, true);
    assert.equal(calls, 1);
  } finally {
    bridge.close();
  }
  await assert.rejects(fetch(bridge.url));
});
