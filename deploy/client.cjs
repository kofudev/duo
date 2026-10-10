// Send one static ZIP to a key restricted to the server-side deploy receiver.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const {
  DUO_SSH_HOST: host,
  DUO_SSH_USER: user,
  DUO_SSH_PORT: port = '22',
  DUO_SSH_KEY_FILE: key,
  DUO_SSH_KNOWN_HOSTS_FILE: known,
} = process.env;
if (
  !host ||
  !/^[a-zA-Z0-9.-]+$/.test(host) ||
  !user ||
  !/^[a-z_][a-z0-9_-]*$/.test(user) ||
  !/^\d{1,5}$/.test(port) ||
  +port < 1 ||
  +port > 65535 ||
  !key ||
  !known
)
  throw new Error('Valid SSH host, user, port, key file and pinned known-hosts file required.');
const file = path.join(root, 'release', `Duo-${version}-site.zip`);
if (fs.statSync(file).size > 20 * 1024 * 1024)
  throw new Error('Site ZIP exceeds deployment limit.');
const ssh = spawn(
  'ssh',
  [
    '-i',
    key,
    '-p',
    port,
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${known}`,
    `${user}@${host}`,
    'deploy',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] }
);
ssh.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
ssh.stdin.on('error', () => {});
fs.createReadStream(file).pipe(ssh.stdin);
ssh.on('exit', (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});
