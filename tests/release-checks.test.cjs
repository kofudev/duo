const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChecksums } = require('../scripts/release-checks.cjs');
const hash = 'a'.repeat(64),
  other = 'b'.repeat(64);
test('Windows release checksums survive Linux artifact download without newline assumptions', () => {
  for (const newline of ['\n', '\r\n']) {
    const text = `${hash}  Duo-Setup-0.4.1.exe${newline}${other}  release.json${newline}`;
    assert.deepEqual(
      [...parseChecksums(text)],
      [
        ['Duo-Setup-0.4.1.exe', hash],
        ['release.json', other],
      ]
    );
  }
});
test('malformed and duplicate release checksum entries are refused', () => {
  for (const text of [
    `${hash}  ../escape.exe\n`,
    `${hash}  Duo.exe\n${other}  Duo.exe\n`,
    `broken  Duo.exe\n`,
    `${hash}  Duo.exe extra\n`,
  ])
    assert.throws(() => parseChecksums(text));
});
