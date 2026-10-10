// Checks tracked files without printing potential credential values.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const gitRoot = cp
  .execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })
  .trim();
if (path.resolve(gitRoot).toLowerCase() !== root.toLowerCase()) throw new Error('Wrong Git root');
const files = cp
  .execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
if (!files.length) throw new Error('No reviewed source files staged');
const findings = [];
const home = os.homedir().replace(/\\/g, '/').toLowerCase();
for (const name of files) {
  if (
    /(^|\/)(qa|release|dist|node_modules|\.cache|\.git)(\/|$)|(^|\/)\.env(?:\.|$)|\.(pem|key)$/i.test(
      name
    )
  )
    findings.push({ file: name, reason: 'private or generated path' });
  if (/\.(png|ico|woff2|jpg|jpeg|gif)$/i.test(name)) continue;
  const body = fs.readFileSync(path.join(root, name), 'utf8');
  if (
    body
      .replace(/\\\\/g, '/')
      .replace(/\\/g, '/')
      .toLowerCase()
      .includes(home + '/')
  )
    findings.push({ file: name, reason: 'local home path' });
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{40,}\b/,
  ];
  if (patterns.some((pattern) => pattern.test(body)))
    findings.push({ file: name, reason: 'possible secret' });
}
console.log(JSON.stringify({ checkedFiles: files.length, findings }));
if (findings.length) process.exitCode = 1;
