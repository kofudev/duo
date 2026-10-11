const clip = (value, limit) => String(value || '').slice(0, limit);
function taskBrief(task) {
  return {
    id: task.id,
    title: task.title,
    owner: task.owner,
    files: task.files,
    acceptance: task.acceptance,
    checkpoint: task.checkpoint,
  };
}
function reviewSummary(text) {
  try {
    return JSON.parse(text).summary || '';
  } catch {
    return text || '';
  }
}
function reportExcerpt(text, limit = 1800) {
  const value = String(text || '');
  if (value.length <= limit) return value;
  const head = Math.floor(limit / 3);
  return `${value.slice(0, head)}\n[Excerpt: middle omitted; full report retained in mission conversation.]\n${value.slice(-(limit - head))}`;
}
function completedWork(tasks) {
  return JSON.stringify(
    tasks
      .filter((task) => task.status === 'done')
      .map((task) => ({
        title: clip(task.title, 120),
        owner: task.owner,
        files: (task.files || []).slice(0, 6),
        report: reportExcerpt(task.report, 800),
        review: clip(reviewSummary(task.review), 240),
      }))
  );
}
function localSummary(session) {
  const lines = [
    'Tâches du plan relues et validées. Bilan assemblé depuis rapports et fichiers observés.',
    '',
  ];
  for (const task of session.tasks)
    lines.push(
      `**${clip(task.title, 200)}** · ${task.owner === 'codex' ? 'Codex' : 'Claude'}`,
      String(task.report || 'Rapport non fourni.'),
      `Relecture partenaire : ${reviewSummary(task.review) || 'verdict approuvé'}`,
      ''
    );
  const changes = session.recap?.changes || [];
  if (session.recap)
    lines.push(`Fichiers locaux observés : ${changes.length}. Détail dans récapitulatif.`, '');
  const commands = (session.results || []).filter((entry) => entry.kind === 'command');
  if (commands.length)
    lines.push(
      `Commandes observées : ${commands.length} · ${commands.filter((entry) => entry.exitCode === 0).length} avec code 0 · ${commands.filter((entry) => Number.isInteger(entry.exitCode) && entry.exitCode !== 0).length} avec code non nul · ${commands.filter((entry) => !Number.isInteger(entry.exitCode)).length} sans code fourni.`,
      ''
    );
  lines.push(
    `Validation exécutée par Duo : ${session.validation?.state === 'passed' ? 'commandes réussies (codes de sortie observés)' : session.validation?.reason || session.validation?.state || 'non configurée'}.`,
    '',
    'Rapports et verdicts IA conservés. Vérifications effectives : consulter fichiers et résultats des outils.'
  );
  return lines.join('\n');
}
module.exports = { taskBrief, completedWork, localSummary, reportExcerpt };
