const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

// One ephemeral, agent-scoped bridge per CLI call. No credential is placed in argv.
async function createToolBridge(specs, call, signal) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (
      req.method !== 'POST' ||
      req.url !== '/tools' ||
      req.headers.origin ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body = '',
      overflow = false;
    req.setEncoding('utf8');
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 800000) {
          overflow = true;
          break;
        }
      }
      res.setHeader('Content-Type', 'application/json');
      if (overflow) throw new Error('Arguments trop volumineux.');
      if (signal?.aborted) throw new Error('Mission arrêtée.');
      const input = JSON.parse(body);
      if (input.method === 'tools/list') res.end(JSON.stringify({ tools: specs }));
      else if (input.method === 'tools/call') {
        if (!specs.some((tool) => tool.name === input.name)) throw new Error('Outil non autorisé.');
        const value = await call(input.name, input.arguments || {});
        res.end(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(value) }],
            isError: false,
          })
        );
      } else throw new Error('Méthode inconnue.');
    } catch (error) {
      if (res.destroyed) return;
      res.end(JSON.stringify({ content: [{ type: 'text', text: error.message }], isError: true }));
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  signal?.addEventListener('abort', close, { once: true });
  return {
    url: `http://127.0.0.1:${server.address().port}/tools`,
    token,
    close: () => {
      signal?.removeEventListener('abort', close);
      close();
    },
  };
}
module.exports = { createToolBridge };
