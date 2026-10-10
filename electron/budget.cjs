const { randomUUID } = require('node:crypto');

const BUDGET_DEFAULTS = Object.freeze({
  collaboration: 'economy',
  durationMinutes: 60,
  timeLimitEnabled: false,
  maxCalls: 24,
  tokenBudget: 500000,
  callTokenReserve: 50000,
  dailyCalls: 60,
  dailyTokens: 1500000,
  quotaReserve: 20,
  quotaPolicy: 'available',
  memoryEnabled: true,
  personalMemoryEnabled: true,
});
const LIMITS = {
  durationMinutes: [1, 1440],
  maxCalls: [1, 200],
  tokenBudget: [1000, 20000000],
  callTokenReserve: [1000, 1000000],
  dailyCalls: [1, 1000],
  dailyTokens: [1000, 100000000],
  quotaReserve: [5, 95],
};
class BudgetStop extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = 'BudgetStop';
  }
}
function budgetPatch(values) {
  const result = {};
  for (const [key, range] of Object.entries(LIMITS))
    if (key in values) {
      const number = Number(values[key]);
      if (!Number.isInteger(number) || number < range[0] || number > range[1])
        throw new Error(`${key} : ${range[0]} à ${range[1]}.`);
      result[key] = number;
    }
  for (const [key, choices] of Object.entries({
    collaboration: ['economy', 'full'],
    quotaPolicy: ['available', 'strict'],
  }))
    if (key in values) {
      if (!choices.includes(values[key])) throw new Error('Politique budget invalide.');
      result[key] = values[key];
    }
  for (const key of ['memoryEnabled', 'personalMemoryEnabled', 'timeLimitEnabled'])
    if (key in values) result[key] = values[key] === true;
  return result;
}
function tokenCount(usage) {
  return Number.isFinite(usage?.inputTokens) &&
    Number.isFinite(usage?.outputTokens) &&
    usage.inputTokens >= 0 &&
    usage.outputTokens >= 0
    ? usage.inputTokens + usage.outputTokens
    : null;
}
function quotaWindows(snapshot) {
  const buckets = snapshot?.rateLimitsByLimitId || snapshot?.rateLimits || snapshot;
  if (!buckets || typeof buckets !== 'object') return [];
  const list = 'primary' in buckets || 'secondary' in buckets ? [buckets] : Object.values(buckets);
  return list.flatMap((bucket) =>
    ['primary', 'secondary']
      .map((kind) => ({ ...bucket?.[kind], kind, limitId: bucket?.limitId || 'codex' }))
      .filter(
        (window) =>
          Number.isFinite(window.usedPercent) &&
          window.usedPercent >= 0 &&
          window.usedPercent <= 100
      )
  );
}
function cleanLedger(value, now = Date.now()) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        Number.isFinite(entry.at) &&
        entry.at > now - 86400000 &&
        entry.at <= now &&
        Number.isFinite(entry.chargedTokens) &&
        entry.chargedTokens >= 0
    )
    .slice(-5000)
    .map((entry) => ({
      ...entry,
      actualTokens:
        Number.isFinite(entry.actualTokens) && entry.actualTokens >= 0 ? entry.actualTokens : 0,
      state: entry.state === 'running' ? 'interrupted' : entry.state,
    }));
}
class UsageBudget {
  constructor(session, config, ledger = [], { now = Date.now } = {}) {
    this.session = session;
    this.config = { ...BUDGET_DEFAULTS, ...config };
    this.ledger = ledger;
    this.now = now;
    this.startedAt = now();
    this.deadline = this.config.timeLimitEnabled
      ? this.startedAt + this.config.durationMinutes * 60000
      : null;
    this.records = new Map();
    this.stopReason = null;
    if (!session.telemetry?.length)
      session.telemetry = ledger.filter((record) => record.sessionId === session.id).slice(-200);
    const previous = session.budget;
    session.budget = {
      deadline: this.deadline,
      maxCalls: this.config.maxCalls,
      tokenBudget: this.config.tokenBudget,
      calls: previous?.calls || 0,
      tokens: previous?.tokens || 0,
      chargedTokens: previous?.chargedTokens || 0,
      unknownCalls: previous?.unknownCalls || 0,
      reserve: this.config.quotaReserve,
      quotaWarnings: previous?.quotaWarnings || [],
    };
  }
  daily() {
    const cutoff = this.now() - 86400000;
    const entries = this.ledger.filter((entry) => entry.at > cutoff);
    return {
      calls: entries.length,
      tokens: entries.reduce((sum, entry) => sum + entry.chargedTokens, 0),
      unknown: entries.filter((entry) => !entry.usageKnown).length,
    };
  }
  fail(message, code) {
    throw new BudgetStop(message, code);
  }
  check() {
    if (this.stopReason) throw this.stopReason;
    if (this.deadline !== null && this.now() >= this.deadline)
      this.fail('Durée maximale atteinte. Travail conservé ; relancer pour continuer.', 'duration');
  }
  async quota(agent, provider) {
    let snapshot = null;
    try {
      if (provider.quota) snapshot = await provider.quota();
    } catch {}
    this.check();
    const windows = quotaWindows(snapshot);
    // An expired snapshot is not evidence of a fresh allowance.
    const current = windows.filter(
      (window) => !Number.isFinite(window.resetsAt) || window.resetsAt * 1000 > this.now()
    );
    if (!current.length) {
      const warning = `${agent === 'codex' ? 'Codex' : 'Claude'} : quota fournisseur indisponible. Budgets locaux seulement.`;
      if (!this.session.budget.quotaWarnings.includes(warning))
        this.session.budget.quotaWarnings.push(warning);
      if (this.config.quotaPolicy === 'strict')
        this.fail(warning + ' Mode strict bloque lancement.', 'quota-unknown');
      return;
    }
    this.session.budget.quotas ||= {};
    this.session.budget.quotas[agent] = { at: this.now(), windows: current };
    for (const window of current)
      if (100 - window.usedPercent <= this.config.quotaReserve) {
        this.fail(
          `${agent} : ${Math.round(100 - window.usedPercent)} % restants. Réserve ${this.config.quotaReserve} % atteinte. Arrêt avant nouvel appel.`,
          'quota-reserve'
        );
      }
  }
  reserve(agent, details = {}) {
    this.check();
    const budget = this.session.budget,
      daily = this.daily(),
      amount = this.config.callTokenReserve;
    if (budget.calls >= this.config.maxCalls)
      this.fail('Maximum appels atteint. Travail conservé.', 'calls');
    if (daily.calls >= this.config.dailyCalls)
      this.fail('Maximum appels Duo sur 24 h atteint.', 'daily-calls');
    if (budget.chargedTokens + amount > this.config.tokenBudget)
      this.fail('Budget tokens mission insuffisant pour réserver prochain appel.', 'tokens');
    if (daily.tokens + amount > this.config.dailyTokens)
      this.fail('Budget tokens Duo sur 24 h insuffisant pour prochain appel.', 'daily-tokens');
    const record = {
      id: randomUUID(),
      sessionId: this.session.id,
      agent,
      phase: String(details.phase || 'Appel').slice(0, 100),
      model: String(details.model || '').slice(0, 160),
      promptChars: Number.isFinite(details.promptChars) ? Math.max(0, details.promptChars) : null,
      at: this.now(),
      chargedTokens: amount,
      actualTokens: 0,
      reservedTokens: amount,
      usageKnown: false,
      state: 'running',
    };
    budget.calls++;
    budget.chargedTokens += amount;
    this.records.set(record.id, record);
    this.ledger.push(record);
    this.session.telemetry.push(record);
    this.session.telemetry = this.session.telemetry.slice(-200);
    // Keep a rolling day. Never evict a pending reservation.
    const cutoff = this.now() - 86400000;
    for (let index = this.ledger.length - 1; index >= 0; index--)
      if (this.ledger[index].at <= cutoff && this.ledger[index].state !== 'running')
        this.ledger.splice(index, 1);
    return record;
  }
  observeQuota(agent, snapshot) {
    const current = quotaWindows(snapshot).filter(
      (window) => !Number.isFinite(window.resetsAt) || window.resetsAt * 1000 > this.now()
    );
    if (!current.length) return;
    const prior = this.session.budget.quotas?.[agent]?.windows || [];
    const merged = prior.filter(
      (window) =>
        !current.some((update) => update.limitId === window.limitId && update.kind === window.kind)
    );
    this.session.budget.quotas ||= {};
    this.session.budget.quotas[agent] = { at: this.now(), windows: [...merged, ...current] };
    if (current.some((window) => 100 - window.usedPercent <= this.config.quotaReserve))
      this.stopReason = new BudgetStop(
        `${agent} : réserve quota ${this.config.quotaReserve} % atteinte pendant appel. Interruption demandée.`,
        'quota-reserve'
      );
  }
  capacity(count, purpose = 'analyses simultanées') {
    this.check();
    const budget = this.session.budget,
      daily = this.daily(),
      reserve = count * this.config.callTokenReserve;
    if (budget.calls + count > this.config.maxCalls || daily.calls + count > this.config.dailyCalls)
      this.fail(`Budget appels insuffisant pour lancer ${purpose}.`, 'calls');
    if (
      budget.chargedTokens + reserve > this.config.tokenBudget ||
      daily.tokens + reserve > this.config.dailyTokens
    )
      this.fail(`Budget tokens insuffisant pour réserver ${purpose}.`, 'tokens');
  }
  observe(record, usage) {
    const amount = tokenCount(usage);
    if (amount === null) return;
    for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens'])
      if (Number.isFinite(usage?.[key]) && usage[key] >= 0)
        record[key] = Math.max(record[key] || 0, usage[key]);
    const budget = this.session.budget,
      delta = Math.max(0, amount - record.actualTokens);
    record.actualTokens += delta;
    budget.tokens += delta;
    record.usageKnown = true;
    const charge = Math.max(record.reservedTokens, record.actualTokens);
    budget.chargedTokens += charge - record.chargedTokens;
    record.chargedTokens = charge;
    if (budget.tokens >= this.config.tokenBudget)
      this.stopReason = new BudgetStop(
        'Seuil tokens mission atteint pendant appel. Interruption demandée.',
        'tokens'
      );
    if (this.daily().tokens > this.config.dailyTokens)
      this.stopReason = new BudgetStop(
        'Seuil tokens Duo sur 24 h atteint pendant appel. Interruption demandée.',
        'daily-tokens'
      );
  }
  finish(record, completed) {
    if (!record || record.state !== 'running') return;
    const budget = this.session.budget;
    record.state = completed ? 'completed' : 'interrupted';
    record.durationMs = Math.max(0, this.now() - record.at);
    // Failed or interrupted calls may have unreported usage: retain their reservation.
    if (completed && record.usageKnown) {
      budget.chargedTokens += record.actualTokens - record.chargedTokens;
      record.chargedTokens = record.actualTokens;
    } else budget.unknownCalls++;
  }
}
module.exports = {
  UsageBudget,
  BudgetStop,
  BUDGET_DEFAULTS,
  budgetPatch,
  tokenCount,
  quotaWindows,
  cleanLedger,
};
