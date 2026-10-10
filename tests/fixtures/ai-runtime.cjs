// Local protocol fixtures. Never contact AI services or inspect credential stores.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const log = (event) =>
  fs.appendFileSync(
    process.env.DUO_FIXTURE_LOG,
    JSON.stringify({ at: Date.now(), pid: process.pid, ...event }) + '\n'
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function phase(prompt) {
  if (prompt.includes('Return ONLY valid JSON')) return 'plan';
  if (prompt.includes('Review actual files again')) return 'review-final';
  if (prompt.includes('Review actual current files')) return 'review';
  if (prompt.includes('Fix these review issues')) return 'correction';
  if (prompt.includes('Task assigned to you')) return 'construction';
  if (prompt.includes('Your prior proposal')) return 'discussion';
  if (prompt.includes('Work log:')) return 'result';
  if (prompt.includes('Deliver one useful final answer')) return 'synthesis';
  return 'proposal';
}
function taskFrom(prompt) {
  const raw = prompt.match(
    /(?:Task assigned to you: |for this task: |again after correction for |\nTask: )([^\n]+)/
  )?.[1];
  if (!raw) return null;
  // Re-review appends prose after the JSON object.
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const character = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === '{') depth++;
    if (!quoted && character === '}' && --depth === 0) return JSON.parse(raw.slice(0, i + 1));
  }
  throw new Error('Fixture task JSON missing');
}
async function report(agent, prompt, project, writable, onTool = () => {}) {
  const type = phase(prompt),
    callId = randomUUID();
  log({
    event: 'start',
    agent,
    phase: type,
    write: writable,
    callId,
    sharedMemoryCanary: prompt.includes('USER_PROFILE_CANARY'),
  });
  await delay(type === 'proposal' ? 550 : 220);
  let result;
  if (type === 'plan')
    result = JSON.stringify({
      summary: 'Simulation locale : deux tâches',
      tasks: [
        {
          title: 'Créer utilitaire',
          owner: 'codex',
          files: ['utility.js'],
          acceptance: 'Module utilisable et marqueur fixture-verified.',
        },
        {
          title: 'Créer interface',
          owner: 'claude',
          files: ['interface.js'],
          acceptance: 'Interface exportée et marqueur fixture-verified.',
        },
      ],
    });
  else if (['construction', 'correction'].includes(type)) {
    if (!writable) throw new Error('Fixture refused write without permission');
    const task = taskFrom(prompt);
    const target = path.resolve(project, task.files[0]);
    if (path.dirname(target) !== project) throw new Error('Fixture path outside selected project');
    onTool('Write', target);
    fs.writeFileSync(
      target,
      `// fixture-verified : simulation locale ${agent}\nmodule.exports = () => '${agent}';\n`
    );
    result = `Simulation locale. ${agent} → ${task.files[0]} créé. Aucun appel IA distant.`;
  } else if (['review', 'review-final'].includes(type)) {
    const task = taskFrom(prompt);
    onTool('Read', path.join(project, task.files[0]));
    const content = fs.readFileSync(path.join(project, task.files[0]), 'utf8');
    const approved = content.includes('fixture-verified') && !prompt.includes('MOCK_ATTENTION');
    log({ event: 'file-read', agent, file: task.files[0], approved, callId });
    result = JSON.stringify({
      approved,
      summary: 'Fichier réellement lu par fixture locale.',
      issues: approved ? [] : ['Défaut simulé persistant.'],
    });
  } else if (['result', 'synthesis'].includes(type))
    result =
      'Simulation locale terminée. Codex + Claude : coordination vérifiée. Aucun modèle distant appelé.';
  else
    result = `Simulation locale ${agent}. Utilitaire → Codex. Interface → Claude. Relecture partenaire.`;
  log({ event: 'end', agent, phase: type, write: writable, callId });
  return result;
}
module.exports = { log, report };
