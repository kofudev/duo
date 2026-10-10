const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'website');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};
function createServer() {
  return http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404, { 'Content-Type': types['.html'] });
        fs.createReadStream(path.join(root, '404.html')).pipe(response);
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(file).pipe(response);
    });
  });
}
if (require.main === module) {
  const server = createServer();
  server.listen(Number(process.env.PORT || 4174), '127.0.0.1', () =>
    console.log(`Duo website: http://127.0.0.1:${server.address().port}`)
  );
}
module.exports = { createServer };
