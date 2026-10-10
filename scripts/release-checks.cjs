function parseChecksums(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9.-]*)$/.exec(line);
    if (!match || entries.has(match[2]))
      throw new Error('Malformed or duplicate release checksum.');
    entries.set(match[2], match[1]);
  }
  return entries;
}
module.exports = { parseChecksums };
