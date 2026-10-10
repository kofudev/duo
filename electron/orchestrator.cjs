const { randomUUID } = require('node:crypto');
const {
  captureReview,
  changedSince,
  evidenceText,
  evidenceSummary,
} = require('./review-evidence.cjs');
const { UsageBudget, BudgetStop } = require('./budget.cjs');
const { recentContext } = require('./memory.cjs');

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeTasks(plan) {
  if (!Array.isArray(plan?.tasks) || !plan.tasks.length)
    throw new Error('Plan structuré invalide. Relancer discussion avant construction.');
  if (plan.tasks.length > 8)
    throw new Error('Plan contient plus de 8 tâches. Réduire périmètre ou regrouper tâches.');
  return plan.tasks.map((task, index) => {
    if (
      typeof task?.title !== 'string' ||
      !task.title.trim() ||
      !['codex', 'claude'].includes(task.owner)
    )
      throw new Error('Plan invalide : responsable ou titre manquant.');
    if (
      task.files &&
      (!Array.isArray(task.files) ||
        task.files.length > 20 ||
        task.files.some(
          (file) =>
            typeof file !== 'string' ||
            !file ||
            /^(?:[a-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(file)
        ))
    )
      throw new Error('Plan invalide : fichiers doivent rester relatifs au projet.');
    return {
      id: randomUUID(),
      title: String(task.title).slice(0, 200),
      owner: task.owner,
      files: Array.isArray(task.files) ? task.files.map(String).slice(0, 20) : [],
      acceptance: String(task.acceptance || ''),
      status: 'pending',
      order: index + 1,
    };
  });
}

class Orchestrator {
  constructor(
    providers,
    emit,
    save,
    skillContext,
    evidence = {
      capture: captureReview,
      changed: changedSince,
      text: evidenceText,
      summary: evidenceSummary,
    },
    services = {}
  ) {
    this.providers = providers;
    this.emit = emit;
    this.save = save;
    this.skillContext = skillContext;
    this.evidence = evidence;
    this.services = services;
    this.active = null;
  }
  event(session, type, payload) {
    this.emit({ sessionId: session.id, type, ...payload });
  }
  message(session, agent, phase, text, id = randomUUID()) {
    const message = { id, agent, phase, text, at: Date.now() };
    session.messages.push(message);
    this.save();
    this.event(session, 'message', { message });
  }
  status(session, phase) {
    session.phase = phase;
    this.save();
    this.event(session, 'phase', { phase });
  }
  async ask(session, config, agent, phase, prompt, write = false) {
    const budget = this.active.budget;
    let reservation;
    if (budget) {
      if (this.active.preflightQuotas?.has(agent)) this.active.preflightQuotas.delete(agent);
      else await budget.quota(agent, this.providers[agent]);
      if (this.active.controller.signal.aborted)
        throw budget.stopReason || new Error('Arrêt demandé.');
      reservation = budget.reserve(agent);
      this.save();
      this.event(session, 'budget', { budget: session.budget });
    }
    const id = randomUUID(),
      startedAt = Date.now();
    this.event(session, 'stream/start', { id, agent, phase });
    session.metrics ||= { calls: 0, agents: {} };
    session.metrics.calls++;
    let usage,
      completed = false;
    const readPolicy =
      agent === 'codex'
        ? 'Read-only filesystem inspection commands such as rg, file listing and reading are permitted. Never execute project code, tests, scripts or installers in read-only phases.'
        : 'Use Read, Glob and Grep only. Never write or execute commands.';
    const instructions = `You are ${agent === 'codex' ? 'Codex' : 'Claude'}, collaborating with the other agent through a shared coordinator. Reply in French. Communicate decisions and useful rationale concisely. Never invent tool results. Never commit, push, deploy, change credentials, or access files unrelated to the selected project, except read-only bundled/enabled skill resources identified below. Do not spawn subagents. ${write ? 'Implement assigned task only. Preserve unrelated changes. Other agent reviews your work afterwards.' : `READ ONLY. Propose or review. Never modify files. ${readPolicy}`}\n${this.skillContext(config.skills, { ...config, prompt, phase })}`;
    try {
      const result = await this.providers[agent].run({
        prompt,
        instructions,
        project: config.project,
        model: config[`${agent}Model`],
        effort: config[`${agent}Effort`],
        commands: config.commands,
        write,
        signal: this.active.controller.signal,
        onDelta: (delta) => this.event(session, 'stream/delta', { id, delta }),
        onTool: (tool, detail) => {
          const entry = {
            id: randomUUID(),
            messageId: id,
            agent,
            phase,
            tool: String(tool).slice(0, 120),
            detail: String(detail).slice(0, 350),
            at: Date.now(),
          };
          session.activity ||= [];
          session.activity.push(entry);
          session.activity = session.activity.slice(-500);
          this.event(session, 'tool', { agent, tool: entry.tool, detail: entry.detail, entry });
        },
        onUsage: (value) => {
          usage = value;
          if (budget) {
            budget.observe(reservation, value);
            this.event(session, 'budget', { budget: session.budget });
            if (budget.stopReason) this.active.controller.abort();
          }
        },
        onQuota: (value) => {
          if (budget) {
            budget.observeQuota(agent, value);
            this.event(session, 'budget', { budget: session.budget });
            if (budget.stopReason) this.active.controller.abort();
          }
        },
      });
      completed = true;
      if (this.active.controller.signal.aborted)
        throw budget?.stopReason || new Error('Arrêt demandé.');
      const metrics = (session.metrics.agents[agent] ||= {
        calls: 0,
        durationMs: 0,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        cacheWriteInputTokens: null,
      });
      metrics.calls++;
      metrics.durationMs += Date.now() - startedAt;
      for (const key of [
        'inputTokens',
        'outputTokens',
        'cachedInputTokens',
        'cacheWriteInputTokens',
      ])
        if (Number.isFinite(usage?.[key]) && usage[key] >= 0)
          metrics[key] = (metrics[key] || 0) + usage[key];
      this.event(session, 'metrics', { metrics: session.metrics });
      this.message(session, agent, phase, result, id);
      return result;
    } catch (error) {
      this.event(session, 'stream/end', { id });
      throw error;
    } finally {
      if (budget) {
        budget.finish(reservation, completed);
        this.save();
        this.event(session, 'budget', { budget: session.budget });
      }
    }
  }
  start(session, prompt, config) {
    if (this.active) throw new Error('Mission déjà en cours. Arrêter avant nouveau lancement.');
    this.active = { controller: new AbortController(), sessionId: session.id };
    session.state = 'running';
    session.project = config.project;
    session.tasks = [];
    session.startedAt = Date.now();
    session.metrics = { calls: 0, agents: {} };
    session.stopReason = null;
    if (this.services.ledger) {
      this.active.budget = new UsageBudget(session, config, this.services.ledger);
      if (this.active.budget.deadline !== null)
        this.active.timer = setTimeout(() => {
          if (!this.active) return;
          this.active.budget.stopReason = new BudgetStop(
            'Durée maximale atteinte. Interruption demandée ; travail conservé.',
            'duration'
          );
          this.active.controller.abort();
        }, this.active.budget.deadline - Date.now());
    }
    try {
      this.message(session, 'user', 'Demande', prompt);
    } catch (error) {
      clearTimeout(this.active.timer);
      this.active = null;
      session.state = 'failed';
      throw error;
    }
    this.execute(session, prompt, config)
      .catch((error) => {
        const budgetStop =
          this.active?.budget?.stopReason || (error instanceof BudgetStop ? error : null);
        session.state = this.active?.userStopped ? 'stopped' : budgetStop ? 'paused' : 'failed';
        if (budgetStop) session.stopReason = { code: budgetStop.code, message: budgetStop.message };
        for (const task of session.tasks)
          if (['running', 'review'].includes(task.status)) task.status = 'attention';
        try {
          this.message(
            session,
            'system',
            budgetStop ? 'Budget · pause' : 'Mission interrompue',
            budgetStop?.message || error.message
          );
        } catch (persistenceError) {
          session.persistenceError = persistenceError.message;
        }
      })
      .finally(() => {
        if (session.state === 'running') session.state = 'completed';
        clearTimeout(this.active.timer);
        session.phase = '';
        session.completedAt = Date.now();
        this.active = null;
        try {
          this.services.checkpoint?.(session, config);
        } catch (error) {
          session.memoryError = error.message;
        }
        try {
          this.save();
        } catch (error) {
          session.persistenceError = error.message;
          this.event(session, 'storage/warning', {
            warning: `Historique non enregistré : ${error.message}. Exporter conversation avant fermer Duo.`,
          });
        }
        this.event(session, 'complete', { session });
      });
  }
  async parallel(jobs) {
    if (this.active.budget) {
      this.active.budget.capacity(jobs.length);
      await Promise.all(
        ['codex', 'claude'].map((agent) => this.active.budget.quota(agent, this.providers[agent]))
      );
      this.active.preflightQuotas = new Set(['codex', 'claude']);
    }
    const pending = jobs.map((job) => (typeof job === 'function' ? job() : job));
    try {
      return await Promise.all(pending);
    } catch (error) {
      this.active.controller.abort();
      await Promise.allSettled(pending);
      throw error;
    }
  }
  async execute(session, prompt, config) {
    const history = recentContext(session.messages);
    const memory =
      config.memoryEnabled !== false || config.personalMemoryEnabled !== false
        ? this.services.memory?.(config, prompt)
        : null;
    session.context = {
      historyChars: history.length,
      memoryChars: memory?.text?.length || 0,
      selectedMemoryIds: memory?.selectedIds || [],
      personalMemoryIds: memory?.personalIds || [],
      projectMemoryIds: memory?.projectIds || [],
      totalNotes: memory?.total || 0,
    };
    const base = `USER REQUEST: ${prompt}\nRECENT CONTEXT: ${history}\nProject: ${config.project}\nPROJECT BRIEF: ${config.projectBrief || '(none)'}\n${memory?.text || ''}\n`;
    if (this.active.budget && config.collaboration === 'economy' && config.mode === 'build') {
      this.status(session, 'Vérification budgets + quotas');
      await Promise.all(
        ['codex', 'claude'].map((agent) => this.active.budget.quota(agent, this.providers[agent]))
      );
      this.active.preflightQuotas = new Set(['codex', 'claude']);
    }
    let gpt = '',
      claude = '';
    if (config.collaboration !== 'economy' || config.mode === 'discuss') {
      this.status(session, 'Deux analyses en parallèle');
      [gpt, claude] = await this.parallel([
        () =>
          this.ask(
            session,
            config,
            'codex',
            'Proposition',
            `${base}Propose a concise actionable plan with division of work between Codex and Claude. Identify uncertainties. Do not implement.`
          ),
        () =>
          this.ask(
            session,
            config,
            'claude',
            'Proposition',
            `${base}Propose a concise actionable plan with division of work between Codex and Claude. Identify uncertainties. Do not implement.`
          ),
      ]);
    }
    for (let round = 0; round < (config.collaboration === 'economy' ? 0 : config.rounds); round++) {
      this.status(session, `Discussion croisée · ${round + 1}/${config.rounds}`);
      [gpt, claude] = await this.parallel([
        () =>
          this.ask(
            session,
            config,
            'codex',
            'Discussion',
            `${base}Your prior proposal: ${gpt.slice(0, 9000)}\nClaude says: ${claude.slice(0, 9000)}\nRespond to Claude, resolve disagreements, refine division of work. Do not implement.`
          ),
        () =>
          this.ask(
            session,
            config,
            'claude',
            'Discussion',
            `${base}Your prior proposal: ${claude.slice(0, 9000)}\nCodex says: ${gpt.slice(0, 9000)}\nRespond to Codex, resolve disagreements, refine division of work. Do not implement.`
          ),
      ]);
    }
    if (config.mode === 'discuss') {
      this.status(session, 'Synthèse commune');
      await this.ask(
        session,
        config,
        'codex',
        'Synthèse',
        `${base}Codex: ${gpt}\nClaude: ${claude}\nDeliver one useful final answer incorporating both perspectives. State unresolved disagreements. Do not implement.`
      );
      return;
    }
    this.status(session, 'Répartition des tâches');
    const planText = await this.ask(
      session,
      config,
      'codex',
      'Plan',
      `${base}Codex: ${gpt}\nClaude: ${claude}\nReturn ONLY valid JSON: {"summary":"...","tasks":[{"title":"...","owner":"codex or claude","files":["relative paths"],"acceptance":"..."}]}. At most 8 concrete tasks. Prefer few coherent tasks to reduce coordination overhead. Assign tasks to both agents when appropriate. Tasks execute sequentially in this shared project. No commit/push/deploy tasks.`
    );
    const plan = extractJson(planText);
    session.tasks = normalizeTasks(plan);
    this.save();
    this.event(session, 'tasks', { tasks: session.tasks });
    for (const task of session.tasks) {
      if (this.active.controller.signal.aborted) throw new Error('Arrêt demandé.');
      if (this.active.budget) this.active.budget.capacity(2, 'construction + relecture');
      task.status = 'running';
      this.save();
      this.event(session, 'tasks', { tasks: session.tasks });
      this.status(session, `${task.owner === 'codex' ? 'Codex' : 'Claude'} · ${task.title}`);
      const result = await this.ask(
        session,
        config,
        task.owner,
        'Construction',
        `${base}Shared plan: ${planText}\nTask assigned to you: ${JSON.stringify(task)}\nCompleted work: ${session.messages
          .filter((m) => m.phase === 'Construction' || m.phase === 'Correction')
          .map((m) => m.text)
          .join('\n')
          .slice(
            -20000
          )}\nImplement this task now. Summarize actual modifications and validations.`,
        true
      );
      task.status = 'review';
      this.event(session, 'tasks', { tasks: session.tasks });
      const reviewer = task.owner === 'codex' ? 'claude' : 'codex';
      this.status(session, `${reviewer === 'codex' ? 'Codex' : 'Claude'} relit ${task.title}`);
      let snapshot = this.evidence.capture(config.project, task);
      task.reviewEvidence = this.evidence.summary(snapshot);
      this.save();
      this.event(session, 'tasks', { tasks: session.tasks });
      const review = await this.ask(
        session,
        config,
        reviewer,
        'Relecture',
        `${base}Review actual current files for this task: ${JSON.stringify(task)}\n${this.evidence.text(snapshot)}Implementer report: ${result}\nReturn ONLY JSON {"approved":true or false,"summary":"...","issues":["actionable issues"]}. Check against request and acceptance criteria. Do not modify files.`
      );
      let verdict = extractJson(review);
      const unstable = () => {
        const changed = this.evidence.changed(snapshot),
          blocked = snapshot.files
            .filter((file) => file.status === 'blocked')
            .map((file) => file.path);
        if (!changed.length && !blocked.length) return false;
        task.status = 'attention';
        session.state = 'attention';
        this.save();
        this.event(session, 'tasks', { tasks: session.tasks });
        this.message(
          session,
          'system',
          'Relecture à vérifier',
          changed.length
            ? `Fichiers changés pendant relecture : ${changed.join(', ')}. Validation arrêtée. Revoir diff.`
            : `Fichiers non vérifiables : ${blocked.join(', ')}. Revoir chemins + permissions.`
        );
        return true;
      };
      if (unstable()) return;
      if (verdict?.approved === false) {
        await this.ask(
          session,
          config,
          task.owner,
          'Correction',
          `${base}Fix these review issues in your assigned task: ${review}\nTask: ${JSON.stringify(task)}. Report actual changes and validation.`,
          true
        );
        snapshot = this.evidence.capture(config.project, task);
        task.reviewEvidence = this.evidence.summary(snapshot);
        this.save();
        this.event(session, 'tasks', { tasks: session.tasks });
        verdict = extractJson(
          await this.ask(
            session,
            config,
            reviewer,
            'Relecture finale',
            `${base}Review actual files again after correction for ${JSON.stringify(task)}. Previous issues: ${review}.\n${this.evidence.text(snapshot)}Return ONLY JSON {"approved":true or false,"summary":"...","issues":["..."]}. Read only.`
          )
        );
        if (unstable()) return;
      }
      task.status = verdict?.approved === true ? 'done' : 'attention';
      this.save();
      this.event(session, 'tasks', { tasks: session.tasks });
      if (task.status === 'attention') {
        session.state = 'attention';
        this.message(
          session,
          'system',
          'Relecture à vérifier',
          'Relecture non validée. Mission arrêtée pour préserver travail. Consulter échanges + diff.'
        );
        return;
      }
    }
    this.status(session, 'Bilan commun');
    await this.ask(
      session,
      config,
      'codex',
      'Résultat',
      `${base}Work log: ${session.messages
        .slice(-12)
        .map((m) => `${m.agent} ${m.phase}: ${m.text.slice(0, 1800)}`)
        .join('\n')
        .slice(
          -16000
        )}\nDeliver concise final report of actual changes, tests executed, remaining issues. No invented verification.`
    );
  }
  stop() {
    if (this.active) {
      this.active.userStopped = true;
      this.active.controller.abort();
    }
  }
}

module.exports = { Orchestrator, extractJson, normalizeTasks };
