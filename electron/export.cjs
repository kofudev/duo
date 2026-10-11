const names = { codex: 'Codex', claude: 'Claude', user: 'Vous', system: 'Duo' };
const oneLine = (value) =>
  String(value || '')
    .replace(/[\r\n]/g, ' ')
    .trim();
const code = (value) => {
  const text = oneLine(value),
    runs = text.match(/`+/g) || [],
    fence = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1);
  return `${fence} ${text} ${fence}`;
};
const count = (value) =>
  Number.isFinite(value) && value >= 0 ? value.toLocaleString('fr-FR') : 'Non fourni';
const date = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : 'Date non fournie';
};
function formatSession(session) {
  const lines = [
    `# ${oneLine(session.title)}`,
    '',
    `Projet : ${code(session.project)}`,
    '',
    `État : ${oneLine(session.state)}`,
    '',
    '## Conversation',
    '',
  ];
  for (const message of session.messages || [])
    lines.push(
      `### ${names[message.agent] || oneLine(message.agent)} · ${oneLine(message.phase)}`,
      '',
      String(message.text || ''),
      ''
    );
  if (session.tasks?.length) {
    lines.push('## Plan et relectures', '');
    for (const task of session.tasks) {
      lines.push(
        `### ${task.order}. ${oneLine(task.title)}`,
        '',
        `Responsable : ${names[task.owner] || oneLine(task.owner)} · état : ${oneLine(task.status)}`,
        ''
      );
      if (task.acceptance) lines.push(`Critères : ${oneLine(task.acceptance)}`, '');
      for (const file of task.reviewEvidence?.files || [])
        lines.push(
          `- ${code(file.path)} · ${file.status}${file.hash ? ` · SHA-256 ${code(file.hash)}` : ''}${file.truncated ? ' · extrait borné' : ''}`
        );
      lines.push('');
    }
  }
  if (session.metrics) {
    lines.push(
      '## Compteurs mission (reprises incluses)',
      '',
      `Appels tentés : ${count(session.metrics.calls)}`,
      '',
      'Entrées comprennent tokens cache quand fournisseur les expose. Compteurs fournis par CLI, sans estimation monétaire.',
      ''
    );
    for (const [agent, metrics] of Object.entries(session.metrics.agents || {}))
      lines.push(
        `- ${names[agent] || oneLine(agent)} : ${count(metrics.calls)} appels terminés · ${count(metrics.inputTokens)} tokens entrée · ${count(metrics.outputTokens)} sortie · ${count(metrics.cachedInputTokens)} cache lu · ${count(metrics.cacheWriteInputTokens)} cache écrit`,
        ''
      );
  }
  if (session.activity?.length) {
    lines.push(
      '## Journal outils observés',
      '',
      'Invocations annoncées par CLI. Voir rapports pour résultats. Maximum 500 événements récents.',
      ''
    );
    for (const entry of session.activity)
      lines.push(
        `- ${date(entry.at)} · ${names[entry.agent] || oneLine(entry.agent)} · ${oneLine(entry.phase)} · ${code(entry.tool)} ${entry.detail ? `: ${code(entry.detail)}` : ''}`
      );
    lines.push('');
  }
  if (session.telemetry?.length) {
    lines.push(
      '## Consommation par appel',
      '',
      'Tokens bruts, cache inclus. Usage reçu pendant interruption peut être partiel. Cache réutilisé ≠ pourcentage d’économie sur abonnement.',
      ''
    );
    for (const record of session.telemetry)
      lines.push(
        `- ${names[record.agent] || oneLine(record.agent)} · ${oneLine(record.phase)} · ${record.usageKnown ? count(record.actualTokens) : 'usage inconnu'} tokens · entrée ${count(record.inputTokens)} · sortie ${count(record.outputTokens)} · cache lu ${count(record.cachedInputTokens)} · cache écrit ${count(record.cacheWriteInputTokens)} · ${oneLine(record.state)}`
      );
    lines.push('');
  }
  if (session.efficiency?.summaryCallsAvoided)
    lines.push(
      `${session.efficiency.summaryCallsAvoided} appel de synthèse évité par assemblage local du bilan. Économie tokens face à un agent seul non mesurée.`,
      ''
    );
  if (session.waiting) lines.push('## Information attendue', '', session.waiting.question, '');
  if (session.config)
    lines.push(
      '## Accès mission',
      '',
      session.config.mode === 'discuss'
        ? 'Lecture seule.'
        : session.config.accessMode === 'full'
          ? 'Accès complet au compte local, commandes et réseau ; quotas actifs.'
          : 'Accès projet.',
      ''
    );
  if (session.validation) {
    lines.push(
      '## Validation exécutée par Duo',
      '',
      `État : ${oneLine(session.validation.state)} · cycles de correction : ${count(session.validation.repairs)}`,
      '',
      oneLine(session.validation.reason),
      ''
    );
    for (const entry of session.results || [])
      if (entry.executor === 'duo')
        lines.push(
          `### ${code(entry.command)}`,
          '',
          `Code : ${Number.isInteger(entry.exitCode) ? entry.exitCode : 'inconnu'} · ${oneLine(entry.status)}`,
          '',
          String(entry.error || ''),
          '',
          String(entry.stdout || ''),
          '',
          String(entry.stderr || ''),
          ''
        );
  }
  if (session.recap) {
    lines.push(
      '## Modifications locales observées',
      '',
      'Comparaison avec début de mission. Modifications extérieures éventuelles incluses. Fichiers sensibles usuels, dépendances et liens exclus.',
      ''
    );
    for (const file of session.recap.changes)
      lines.push(
        `- ${code(file.path)} · ${file.kind}${file.hash ? ` · SHA-256 ${code(file.hash)}` : ''}`
      );
    if (session.recap.limited)
      lines.push('', 'Couverture limitée ; gros fichiers suivis par métadonnées.');
    lines.push('');
  }
  if (session.results?.length) {
    lines.push('## Résultats outils observés', '');
    for (const entry of session.results)
      lines.push(
        `- ${date(entry.at)} · ${entry.remote ? code(entry.connection) : names[entry.agent]} · ${code(entry.command || entry.path)} · ${Number.isInteger(entry.exitCode) ? `code ${entry.exitCode}` : oneLine(entry.status || entry.kind)}${entry.hash ? ` · SHA-256 ${code(entry.hash)}` : ''}`
      );
    lines.push('');
  }
  if (session.budget) {
    lines.push(
      '## Budgets et contexte',
      '',
      `Échéance : ${session.budget.deadline ? date(session.budget.deadline) : 'Durée libre (budgets conservés)'}`,
      '',
      `Appels : ${count(session.budget.calls)} / ${count(session.budget.maxCalls)} · tokens connus : ${count(session.budget.tokens)} · tokens comptés avec réservations : ${count(session.budget.chargedTokens)} / ${count(session.budget.tokenBudget)}`,
      '',
      'Réservations estimées ; consommation réelle en cours peut dépasser seuil. Quotas partagés avec autres applications.',
      ''
    );
    if (session.stopReason) lines.push(`Pause : ${oneLine(session.stopReason.message)}`, '');
    for (const warning of session.budget.quotaWarnings || []) lines.push(`- ${oneLine(warning)}`);
    if (session.context)
      lines.push(
        '',
        `Mémoire sélectionnée : ${count(session.context.selectedMemoryIds?.length)} / ${count(session.context.totalNotes)} notes · ${count(session.context.memoryChars)} caractères mémoire · ${count(session.context.historyChars)} caractères historique.`,
        ''
      );
  }
  return lines.join('\n');
}
module.exports = { formatSession };
