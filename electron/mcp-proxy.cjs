// Narrow stdio MCP adapter. Runs as a child Node process, not in the renderer.
const readline = require('node:readline');
const endpoint = process.env.DUO_TOOL_ENDPOINT;
const token = process.env.DUO_TOOL_TOKEN;
const send = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let message;
  try {
    if (Buffer.byteLength(line) > 800000) throw new Error('Arguments trop volumineux.');
    message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === 'initialize')
      return send(message.id, {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'duo', version: '1.0.0' },
      });
    if (message.method === 'ping') return send(message.id, {});
    if (!['tools/list', 'tools/call'].includes(message.method))
      throw new Error('Méthode inconnue.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method: message.method, ...message.params }),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    if (!response.ok) throw new Error('Outils Duo indisponibles.');
    send(message.id, await response.json());
  } catch (error) {
    if (message?.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: error.message },
        }) + '\n'
      );
  }
});
