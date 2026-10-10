const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const CLAUDE_SOURCE = 'https://code.claude.com/docs/en/model-config';
const VERIFIED_AT = '2026-10-09';
const ALL_CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const EARLIER_EFFORTS = ['low', 'medium', 'high', 'max'];
function parseVersion(text) {
  return String(text || '').match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] || '';
}
function atLeast(actual, minimum) {
  if (!actual) return false;
  const a = actual.split(/[.-]/).slice(0, 3).map(Number),
    b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
function highestEffort(model) {
  return (
    [...(model?.efforts || [])].sort(
      (a, b) => EFFORT_ORDER.indexOf(b) - EFFORT_ORDER.indexOf(a)
    )[0] || ''
  );
}
const definitions = [
  ['claude-fable-5-1', 'Fable 5.1', 'fable', ALL_CLAUDE_EFFORTS, 'high', '2.1.257', true, false],
  ['claude-opus-5-5', 'Opus 5.5', 'opus', ALL_CLAUDE_EFFORTS, 'medium', '2.1.280', false, false],
  [
    'claude-sonnet-5-5',
    'Sonnet 5.5',
    'sonnet',
    ALL_CLAUDE_EFFORTS,
    'medium',
    '2.1.284',
    false,
    false,
  ],
  ['claude-haiku-5-5', 'Haiku 5.5', 'haiku', ALL_CLAUDE_EFFORTS, 'medium', '2.1.293', false, false],
  ['claude-fable-5', 'Fable 5', 'fable', ALL_CLAUDE_EFFORTS, 'high', null, true, true],
  ['claude-opus-5', 'Opus 5', 'opus', ALL_CLAUDE_EFFORTS, 'high', null, false, true],
  ['claude-sonnet-5', 'Sonnet 5', 'sonnet', ALL_CLAUDE_EFFORTS, 'high', null, false, true],
  ['claude-opus-4-8', 'Opus 4.8', 'opus', ALL_CLAUDE_EFFORTS, 'high', null, false, true],
  ['claude-opus-4-7', 'Opus 4.7', 'opus', ALL_CLAUDE_EFFORTS, 'xhigh', null, false, true],
  ['claude-opus-4-6', 'Opus 4.6', 'opus', EARLIER_EFFORTS, 'high', null, false, true],
  ['claude-sonnet-4-6', 'Sonnet 4.6', 'sonnet', EARLIER_EFFORTS, 'high', null, false, true],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5', 'haiku', [], '', null, false, true],
];
function claudeCatalog(version = '') {
  const items = definitions.map(
    ([id, name, family, efforts, defaultEffort, minimumVersion, mayUseCredits, legacy]) => ({
      id,
      name,
      family,
      efforts,
      defaultEffort,
      minimumVersion,
      mayUseCredits,
      legacy,
      source: CLAUDE_SOURCE,
      verifiedAt: VERIFIED_AT,
      provider: 'claude',
      discovery: 'documentation',
      status: !version
        ? 'unknown'
        : !minimumVersion || atLeast(version, minimumVersion)
          ? 'account-check'
          : 'update-required',
      context: id.includes('4-6')
        ? '200k · variante 1M possible'
        : id.includes('4-5')
          ? '200k'
          : '1M',
    })
  );
  const aliasTarget = (family) => {
    const history = {
      opus: [
        ['2.1.280', 'claude-opus-5-5'],
        ['2.1.219', 'claude-opus-5'],
        ['2.1.154', 'claude-opus-4-8'],
        ['0.0.0', 'claude-opus-4-7'],
      ],
      sonnet: [
        ['2.1.284', 'claude-sonnet-5-5'],
        ['2.1.197', 'claude-sonnet-5'],
        ['0.0.0', 'claude-sonnet-4-6'],
      ],
      haiku: [
        ['2.1.293', 'claude-haiku-5-5'],
        ['0.0.0', 'claude-haiku-4-5-20251001'],
      ],
      fable: [
        ['2.1.257', 'claude-fable-5-1'],
        ['0.0.0', 'claude-fable-5'],
      ],
    };
    const id = history[family].find(([minimum]) => atLeast(version || '0.0.0', minimum))[1];
    return items.find((m) => m.id === id);
  };
  const aliases = ['opus', 'sonnet', 'haiku', 'fable', 'best'].map((alias) => {
    const target = aliasTarget(alias === 'best' ? 'fable' : alias);
    return {
      ...target,
      id: alias,
      name: `${alias[0].toUpperCase() + alias.slice(1)} · automatique`,
      alias: true,
      resolved: version ? target.id : null,
      description:
        alias === 'best'
          ? 'Fable si disponible, sinon Opus. Accès selon compte.'
          : `Alias officiel. Version dépend CLI + compte.`,
      mayUseCredits: alias === 'best' || target.mayUseCredits,
    };
  });
  // Default clears the model override; capabilities cannot be known without account discovery.
  aliases.unshift({
    id: 'default',
    name: 'Défaut compte',
    alias: true,
    provider: 'claude',
    efforts: [],
    defaultEffort: '',
    source: CLAUDE_SOURCE,
    verifiedAt: VERIFIED_AT,
    discovery: 'documentation',
    status: 'account-check',
    mayUseCredits: true,
    description:
      'Claude Code choisit modèle + effort selon abonnement. Crédits possibles si modèle Fable.',
    context: 'Selon compte',
  });
  return [...aliases, ...items];
}
function mergeClaudeCatalog(version, live = []) {
  const documented = claudeCatalog(version),
    result = new Map(documented.map((model) => [model.id, model]));
  for (const item of live) {
    if (
      typeof item?.value !== 'string' ||
      item.value.length > 160 ||
      typeof item.displayName !== 'string'
    )
      continue;
    const baseId = item.value.replace(/\[1m\]$/i, ''),
      base = result.get(item.value) || documented.find((model) => model.id === baseId) || {};
    const resolved = item.resolvedModel || null,
      resolvedModel = documented.find((model) => model.id === resolved);
    const efforts =
      item.supportsEffort === false
        ? []
        : Array.isArray(item.supportedEffortLevels)
          ? item.supportedEffortLevels.filter((level) => ALL_CLAUDE_EFFORTS.includes(level))
          : base.efforts || [];
    result.set(item.value, {
      ...base,
      id: item.value,
      name: item.displayName,
      description: item.description || base.description || '',
      provider: 'claude',
      efforts: [...new Set(efforts)],
      defaultEffort: efforts.includes(base.defaultEffort) ? base.defaultEffort : '',
      discovery: 'live',
      status: base.status === 'update-required' ? base.status : 'listed',
      source: 'https://code.claude.com/docs/en/agent-sdk/typescript',
      verifiedAt: new Date().toISOString().slice(0, 10),
      resolved: resolved || base.resolved,
      resolvedSource: resolved ? 'live' : base.resolved ? 'documentation' : null,
      context: /\[1m\]$/i.test(item.value) ? '1M' : base.context,
      mayUseCredits: resolvedModel
        ? resolvedModel.mayUseCredits
        : base.mayUseCredits || /fable|best/i.test(item.value),
      supportsAdaptiveThinking: item.supportsAdaptiveThinking,
      supportsFastMode: item.supportsFastMode,
      supportsAutoMode: item.supportsAutoMode,
    });
  }
  return [...result.values()];
}
function customClaudeModel(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:[\]-]{0,159}$/.test(id))
    throw new Error('ID modèle Claude invalide.');
  return {
    id,
    name: id,
    provider: 'claude',
    custom: true,
    efforts: [],
    defaultEffort: '',
    status: 'unknown',
    discovery: 'custom',
    mayUseCredits: /fable|best/i.test(id),
    description: 'ID fourni manuellement. Capacités et accès non vérifiés.',
  };
}
function validateModels(config, catalog) {
  const codex = catalog.codex.find((m) => m.id === config.codexModel);
  if (!codex || !codex.efforts.includes(config.codexEffort))
    throw new Error('Choisir modèle Codex + effort annoncés par CLI.');
  const claude =
    catalog.claude.find((m) => m.id === config.claudeModel) ||
    customClaudeModel(config.claudeModel);
  if (claude.status === 'update-required')
    throw new Error(
      `${claude.name} exige Claude Code ${claude.minimumVersion}+. Actualiser CLI puis connexions.`
    );
  if (config.claudeEffort && !claude.efforts.includes(config.claudeEffort))
    throw new Error(
      'Effort non documenté pour ce modèle Claude. Choisir Automatique ou niveau compatible.'
    );
  if (claude.mayUseCredits && config.allowUsageCredits !== true)
    throw new Error(
      'Modèle peut débiter crédits supplémentaires Claude. Activer option crédits pour cette mission ou choisir Opus/Sonnet/Haiku.'
    );
  return { codex, claude };
}
module.exports = {
  EFFORT_ORDER,
  CLAUDE_SOURCE,
  VERIFIED_AT,
  parseVersion,
  atLeast,
  highestEffort,
  claudeCatalog,
  mergeClaudeCatalog,
  customClaudeModel,
  validateModels,
};
