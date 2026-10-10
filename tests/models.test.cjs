const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claudeCatalog,
  mergeClaudeCatalog,
  highestEffort,
  validateModels,
  parseVersion,
} = require('../electron/models.cjs');
const codex = [{ id: 'live-model', efforts: ['low', 'high', 'ultra'] }];
test('old CLI shows newest Claude models as requiring update and preserves supported alias efforts', () => {
  const catalog = claudeCatalog('2.1.146');
  assert.equal(catalog.find((m) => m.id === 'claude-opus-5-5').status, 'update-required');
  assert.equal(catalog.find((m) => m.id === 'opus').resolved, 'claude-opus-4-7');
  assert.equal(catalog.find((m) => m.id === 'sonnet').resolved, 'claude-sonnet-4-6');
  assert.deepEqual(catalog.find((m) => m.id === 'haiku').efforts, []);
  assert.equal(highestEffort(catalog.find((m) => m.id === 'claude-opus-4-6')), 'max');
  assert.ok(!catalog.find((m) => m.id === 'claude-opus-4-6').efforts.includes('xhigh'));
});
test('new CLI aliases follow documented version boundaries', () => {
  const catalog = claudeCatalog('2.1.293');
  assert.equal(catalog.find((m) => m.id === 'opus').resolved, 'claude-opus-5-5');
  assert.equal(catalog.find((m) => m.id === 'sonnet').resolved, 'claude-sonnet-5-5');
  assert.equal(catalog.find((m) => m.id === 'haiku').resolved, 'claude-haiku-5-5');
  assert.equal(catalog.find((m) => m.id === 'fable').resolved, 'claude-fable-5-1');
  assert.equal(catalog.find((m) => m.id === 'claude-haiku-5-5').status, 'account-check');
  assert.equal(parseVersion('codex-cli 0.162.0-alpha.2'), '0.162.0-alpha.2');
});
test('validation blocks unsupported efforts, outdated CLI, and unapproved usage credits', () => {
  const catalogs = { codex, claude: claudeCatalog('2.1.146') };
  const config = {
    codexModel: 'live-model',
    codexEffort: 'ultra',
    claudeModel: 'opus',
    claudeEffort: 'max',
  };
  assert.ok(validateModels(config, catalogs));
  assert.throws(() => validateModels({ ...config, codexEffort: 'medium' }, catalogs), /annoncés/);
  assert.throws(() => validateModels({ ...config, claudeModel: 'haiku' }, catalogs), /Effort/);
  assert.throws(
    () => validateModels({ ...config, claudeModel: 'claude-opus-5-5' }, catalogs),
    /2.1.280/
  );
  assert.throws(() => validateModels({ ...config, claudeModel: 'fable' }, catalogs), /crédits/);
  assert.ok(validateModels({ ...config, claudeModel: 'fable', allowUsageCredits: true }, catalogs));
  assert.ok(
    validateModels({ ...config, claudeModel: 'nouveau-modele', claudeEffort: '' }, catalogs)
  );
  assert.throws(
    () => validateModels({ ...config, claudeModel: 'model;bad', claudeEffort: '' }, catalogs),
    /invalide/
  );
});

test('Claude live metadata overrides alias capabilities and keeps documented versions', () => {
  const catalog = mergeClaudeCatalog('2.1.293', [
    {
      value: 'opus',
      displayName: 'Live Opus',
      resolvedModel: 'claude-opus-5-5',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'max', 'invented'],
    },
    { value: 'sonnet[1m]', displayName: 'Sonnet 1M', supportedEffortLevels: ['high'] },
    { value: 'haiku', displayName: 'Haiku', supportsEffort: false, supportedEffortLevels: ['max'] },
  ]);
  const opus = catalog.find((m) => m.id === 'opus');
  assert.equal(opus.discovery, 'live');
  assert.deepEqual(opus.efforts, ['low', 'max']);
  assert.equal(opus.resolvedSource, 'live');
  assert.equal(catalog.find((m) => m.id === 'sonnet[1m]').context, '1M');
  assert.deepEqual(catalog.find((m) => m.id === 'haiku').efforts, []);
  assert.ok(catalog.some((m) => m.id === 'claude-opus-4-6'));
  const old = mergeClaudeCatalog('2.1.146', [
    { value: 'claude-fable-5-1[1m]', displayName: 'Fable', supportedEffortLevels: ['max'] },
  ]);
  assert.equal(old.find((m) => m.id === 'claude-fable-5-1[1m]').status, 'update-required');
});
