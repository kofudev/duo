const { randomUUID } = require('node:crypto');
const {
  captureReview,
  changedSince,
  evidenceText,
  evidenceSummary,
} = require('./review-evidence.cjs');
const { UsageBudget, BudgetStop } = require('./budget.cjs');
const { recentContext } = require('./memory.cjs');
const { captureMission, compareMission } = require('./mission-evidence.cjs');
const { teamTools } = require('./team-tools.cjs');
const { taskBrief, completedWork, localSummary, reportExcerpt } = require('./efficiency.cjs');
const { planSchema, reviewSchema } = require('./mission-schema.cjs');
const continuation = (text) =>
  /^(?:continue[rz]?|continuer|reprendre|reprends|resume|go|vas[- ]?y|poursuis|poursuivre)[\s.!]*$/i.test(
    text.trim()
  );
class UserWait extends Error {}
function waitingRequest(result) {
  const value = extractJson(result);
  if (
    value &&
    (value.status === 'waiting_user' || value.waiting_user === true || value.blocked === 'user')
  )
    return {
      question: String(value.question || value.summary || 'Préciser information manquante.'),
      options: Array.isArray(value.options) ? value.options : [],
    };
  // Compatibility with existing CLI reports: only explicit human-blocking language.
  if (
    /(?:attente utilisateur|waiting[_ ]user|bloqu[ée].{0,40}(?:dossier|sources|permission|utilisateur))/i.test(
      result
    ) &&
    /(?:ouvrir|choisir|confirmer|fournir|question|\?)/i.test(result)
  )
    return { question: result.slice(0, 3000), options: [] };
  return null;
}
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
    throw new Error(
      'Plan structuré invalide. Réponse conservée ; préciser demande avant reprendre.'
    );
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
  wait(session, request) {
    if (
      request.options &&
      (!Array.isArray(request.options) ||
        request.options.some((value) => typeof value !== 'string' || value.length > 500))
    )
      throw new Error('Options question invalides.');
    session.waiting = {
      question: String(request.question).slice(0, 4000),
      options: (request.options || []).map(String).slice(0, 4),
      at: Date.now(),
    };
    this.active.waiting = session.waiting;
    this.save();
    this.event(session, 'waiting', { waiting: session.waiting });
    return new UserWait(session.waiting.question);
  }
  recap(session) {
    if (!session.progress?.baseline) return;
    try {
      session.recap = {
        ...compareMission(session.progress.baseline, captureMission(session.project)),
        basis: session.progress.baselineBasis || 'mission',
      };
      this.save();
      this.event(session, 'recap', { recap: session.recap });
    } catch (error) {
      session.recapError = error.message;
    }
  }
  teamStatus(session) {
    return {
      objective: session.progress?.objective,
      tasks: session.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        owner: task.owner,
        status: task.status,
        checkpoint: task.checkpoint,
        files: task.files,
        acceptance: String(task.acceptance || '').slice(0, 1200),
        report: task.report?.slice(-2500),
        review: task.review?.slice(-1500),
      })),
      working: this.active?.working || {},
      activity: (session.activity || [])
        .slice(-12)
        .map(({ agent, phase, tool, detail, at }) => ({ agent, phase, tool, detail, at })),
      recentMessages: session.messages
        .filter((message) => ['codex', 'claude'].includes(message.agent))
        .slice(-8)
        .map(({ agent, phase, text }) => ({ agent, phase, text: text.slice(-3000) })),
      changes: session.recap?.changes || [],
      selectedSSH: session.config?.sshProfileId || null,
    };
  }
  async toolCall(session, config, agent, phase, write, consultation, name, args) {
    if (this.active?.controller.signal.aborted) throw new Error('Mission arrêtée.');
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new Error('Arguments invalides.');
    const text = (key) => {
      if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > 6000)
        throw new Error('Message requis (6000 caractères max.).');
      return args[key].trim();
    };
    const partner = agent === 'codex' ? 'claude' : 'codex';
    if (name === 'duo_team_status') return this.teamStatus(session);
    if (name === 'duo_request_user') {
      const error = this.wait(session, { question: text('question'), options: args.options });
      this.active.controller.abort();
      throw error;
    }
    if (name === 'duo_message_partner') {
      this.message(
        session,
        agent,
        `Message → ${partner === 'codex' ? 'Codex' : 'Claude'}`,
        text('message')
      );
      return {
        delivered: true,
        partner,
        note: 'Message partagé. Utiliser consultation pour réponse immédiate.',
      };
    }
    if (name === 'duo_consult_partner') {
      if (consultation)
        throw new Error('Consultation récursive interdite. Répondre directement au partenaire.');
      if (this.active.working[partner])
        return {
          busy: true,
          partner,
          instruction:
            'Partenaire déjà actif. Lire tableau partagé ou envoyer message sans démarrer nouvel appel.',
        };
      const key = this.active.taskId || 'planning';
      session.progress.consultations ||= {};
      if ((session.progress.consultations[key] || 0) >= 3)
        throw new Error(
          'Trois consultations déjà utilisées pour cette étape. Avancer avec réponses disponibles.'
        );
      this.active.budget?.capacity(2, 'consultation + relecture');
      session.progress.consultations[key] = (session.progress.consultations[key] || 0) + 1;
      const question = text('question');
      this.message(
        session,
        agent,
        `Question → ${partner === 'codex' ? 'Codex' : 'Claude'}`,
        question
      );
      const pending = this.ask(
        session,
        config,
        partner,
        `Réponse → ${agent === 'codex' ? 'Codex' : 'Claude'}`,
        `Partner ${agent} asks: ${question}\nSHARED MISSION: ${JSON.stringify(this.teamStatus(session))}\nInspect actual relevant project files. Give a concrete useful answer. Do not implement. Do not recursively consult partner.`,
        false,
        true
      );
      this.active.pendingConsultations.add(pending);
      let answer;
      try {
        answer = await pending;
      } finally {
        this.active.pendingConsultations.delete(pending);
      }
      return { partner, answer };
    }
    if (name.startsWith('duo_ssh_') && config.sshProfileId && this.services.ssh) {
      const operation = name.slice('duo_ssh_'.length);
      const entry = {
        id: randomUUID(),
        agent,
        phase,
        at: Date.now(),
        remote: true,
        tool: name,
        path: args.path || '',
        command: args.command || '',
        kind: operation === 'run' ? 'command' : operation,
        connection: this.services.ssh.profile(config.sshProfileId).name,
        status: 'running',
      };
      session.results ||= [];
      session.results.push(entry);
      session.results = session.results.slice(-200);
      this.save();
      this.event(session, 'result', { entry });
      try {
        const result = await this.services.ssh.call(config.sshProfileId, operation, args, {
          write,
          commands: config.commands,
          signal: this.active.controller.signal,
        });
        const { content, stdout, stderr, ...metadata } = result;
        Object.assign(entry, metadata, {
          status:
            Number.isInteger(result.exitCode) && result.exitCode !== 0 ? 'failed' : 'completed',
        });
        return result;
      } catch (error) {
        entry.status = ['write', 'run'].includes(operation) ? 'unknown' : 'failed';
        entry.error = error.message.slice(0, 1000);
        throw error;
      } finally {
        this.save();
        this.event(session, 'result', { entry });
      }
    }
    throw new Error('Outil non autorisé pour cette mission.');
  }
  async ask(session, config, agent, phase, prompt, write = false, consultation = false) {
    const budget = this.active.budget;
    let reservation;
    if (budget) {
      if (this.active.preflightQuotas?.has(agent)) this.active.preflightQuotas.delete(agent);
      else await budget.quota(agent, this.providers[agent]);
      if (this.active.controller.signal.aborted)
        throw budget.stopReason || new Error('Arrêt demandé.');
      reservation = budget.reserve(agent, {
        phase,
        model: config[`${agent}Model`],
        promptChars: prompt.length,
      });
      this.save();
      this.event(session, 'budget', { budget: session.budget, telemetry: session.telemetry });
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
    const sshProfile = config.sshProfileId && this.services.ssh?.profile(config.sshProfileId);
    const sharedTools = teamTools({
      ssh: !!sshProfile,
      write: write && sshProfile?.allowWrite,
      commands: write && config.commands && sshProfile?.allowCommands,
    });
    const instructions = `You are ${agent === 'codex' ? 'Codex' : 'Claude'}, collaborating with the other agent in Duo. Reply in French. Communicate useful decisions, never private chain of thought. Never invent tool results. Never commit, push or change credentials. Access only selected local project and enabled skill resources. ${sshProfile ? `Selected SSH target: ${sshProfile.name}, remote folder ${sshProfile.root}. Use ONLY Duo SSH tools for this target. Remote writing ${write && sshProfile.allowWrite ? 'authorized within user request' : 'disabled'}. Remote shell ${write && config.commands && sshProfile.allowCommands ? 'explicitly enabled; starting folder is NOT a sandbox, preserve unrelated services' : 'disabled'}. Deploy only when user objective explicitly requests deployment to this target.` : 'No remote target authorized. Never deploy.'} Do not spawn subagents. Read duo_team_status before work. Share concrete findings with duo_message_partner. ${consultation ? 'Answer partner directly, no recursive consultation.' : 'Consult partner with duo_consult_partner when their inspection can resolve a technical uncertainty, especially before significant implementation. Responses are real model calls and consume budget. Avoid repetitive chatter.'} If USER information, selected folder or permission is missing, call duo_request_user immediately and stop. Alternatively return JSON {"status":"waiting_user","question":"actionable question","options":[]}. Never treat a missing user choice as a code defect or request CONTINUE repeatedly. ${write ? 'Implement assigned task only. Preserve unrelated changes. Other agent reviews actual files afterwards. On resumption inspect existing partial work first. Verify remote action outcomes before repeating non-idempotent commands.' : `READ ONLY. Propose or review. Never modify files. ${readPolicy}`}\n${this.skillContext(config.skills, { ...config, prompt, phase })}`;
    this.active.working[agent] = { phase, write, startedAt };
    const providerInstructions =
      instructions +
      (config.collaboration === 'economy'
        ? '\nEFFICIENCY: Consult partner for unresolved technical decisions that affect work. Routine confirmation belongs in the mandatory peer review, not an additional consultation. Keep handoffs under 120 words unless needed to explain critical failures. Never omit failed tests, missing checks or acceptance requirements.'
        : '');
    if (reservation) reservation.instructionsChars = providerInstructions.length;
    try {
      const result = await this.providers[agent].run({
        prompt,
        instructions: providerInstructions,
        outputSchema:
          phase === 'Plan' ? planSchema : phase.startsWith('Relecture') ? reviewSchema : undefined,
        project: config.project,
        model: config[`${agent}Model`],
        effort: config[`${agent}Effort`],
        commands: config.commands,
        write,
        tools: sharedTools,
        onToolCall: (name, args) => {
          if (!sharedTools.some((tool) => tool.name === name))
            throw new Error('Outil non autorisé.');
          return this.toolCall(session, config, agent, phase, write, consultation, name, args);
        },
        onUserInput: (questions) => {
          this.wait(session, {
            question: questions.map((item) => item.question).join('\n'),
            options: questions.length === 1 ? questions[0].options?.map((item) => item.label) : [],
          });
          this.active.controller.abort();
        },
        onToolResult: (result) => {
          const entry = {
            id: randomUUID(),
            agent,
            phase,
            at: Date.now(),
            ...result,
            command: String(result.command || '').slice(0, 6000),
          };
          session.results ||= [];
          session.results.push(entry);
          session.results = session.results.slice(-200);
          this.save();
          this.event(session, 'result', { entry });
        },
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
            this.event(session, 'budget', { budget: session.budget, telemetry: session.telemetry });
            if (budget.stopReason) this.active.controller.abort();
          }
        },
        onQuota: (value) => {
          if (budget) {
            budget.observeQuota(agent, value);
            this.event(session, 'budget', { budget: session.budget, telemetry: session.telemetry });
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
      const waiting = waitingRequest(result);
      if (waiting) throw this.wait(session, waiting);
      return result;
    } catch (error) {
      this.event(session, 'stream/end', { id });
      throw error;
    } finally {
      delete this.active.working[agent];
      if (write) this.recap(session);
      if (budget) {
        budget.finish(reservation, completed);
        this.save();
        this.event(session, 'budget', { budget: session.budget, telemetry: session.telemetry });
      }
    }
  }
  start(session, prompt, config) {
    if (this.active) throw new Error('Mission déjà en cours. Arrêter avant nouveau lancement.');
    if (
      continuation(prompt) &&
      (session.waiting ||
        session.state === 'attention' ||
        (session.state === 'completed' &&
          (session.progress?.mode || session.config?.mode || config.mode) === config.mode))
    ) {
      this.message(
        session,
        'system',
        'Reprise',
        session.waiting
          ? `Information toujours manquante : ${session.waiting.question}\nRépondre à cette question ou choisir autre dossier. Aucun appel IA lancé.`
          : session.state === 'completed'
            ? 'Mission terminée. Décrire prochaine modification pour lancer nouveau travail.'
            : 'Relecture non validée. Préciser correction souhaitée ou vérifier fichiers avant reprendre. Aucun appel IA lancé.'
      );
      this.event(session, 'complete', { session });
      return;
    }
    // Older stored missions have tasks but no checkpoint plan. Inspect partial work before writing.
    if (
      !session.progress &&
      session.state !== 'completed' &&
      session.tasks.length &&
      config.mode === 'build'
    ) {
      const requests = session.messages
        .filter((message) => message.agent === 'user' && !continuation(message.text))
        .map((message) => message.text);
      session.progress = {
        objective: requests[0] || prompt,
        mode: config.mode,
        stage: 'tasks',
        updates: requests.slice(1).slice(-10),
        baselineBasis: 'resume',
      };
      session.progress.planText = JSON.stringify({
        summary: 'Plan conservé depuis ancienne mission',
        tasks: session.tasks,
      });
      for (const task of session.tasks)
        task.checkpoint ||=
          task.status === 'done' ? 'done' : task.status === 'pending' ? 'implement' : 'review';
      try {
        session.progress.baseline = captureMission(config.project);
      } catch {}
    }
    const resume =
      session.progress && session.state !== 'completed' && config.mode === session.progress.mode;
    if (!resume) {
      const objective = continuation(prompt)
        ? [...session.messages]
            .reverse()
            .find((message) => message.agent === 'user' && !continuation(message.text))?.text ||
          prompt
        : prompt;
      session.progress = { objective, mode: config.mode, stage: 'analysis', updates: [] };
      session.tasks = [];
      session.metrics = { calls: 0, agents: {} };
      session.telemetry = [];
      session.efficiency = { summaryCallsAvoided: 0 };
      session.budget = null;
      session.results = [];
      session.recap = null;
      try {
        session.progress.baseline = captureMission(config.project);
      } catch {}
      session.startedAt = Date.now();
    } else if (!continuation(prompt)) {
      session.progress.updates.push(prompt);
      session.progress.updates = session.progress.updates.slice(-10);
      if (session.state === 'attention') {
        const task = session.tasks.find((item) => item.status === 'attention');
        if (task) {
          task.checkpoint = 'correct';
          task.corrections = 0;
        }
      }
    }
    session.config = config;
    this.active = {
      controller: new AbortController(),
      sessionId: session.id,
      working: {},
      pendingConsultations: new Set(),
    };
    session.state = 'running';
    session.project = config.project;
    session.waiting = null;
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
        session.state = this.active?.userStopped
          ? 'stopped'
          : this.active?.waiting
            ? 'waiting_user'
            : budgetStop
              ? 'paused'
              : 'failed';
        if (budgetStop) session.stopReason = { code: budgetStop.code, message: budgetStop.message };
        for (const task of session.tasks)
          if (['running', 'review'].includes(task.status))
            task.status = session.state === 'waiting_user' ? 'waiting' : 'paused';
        try {
          this.message(
            session,
            'system',
            session.state === 'waiting_user'
              ? 'À vous de répondre'
              : budgetStop
                ? 'Budget · pause'
                : 'Mission interrompue',
            this.active?.waiting?.question || budgetStop?.message || error.message
          );
        } catch (persistenceError) {
          session.persistenceError = persistenceError.message;
        }
      })
      .finally(async () => {
        await Promise.allSettled([...this.active.pendingConsultations]);
        this.recap(session);
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
    // A persisted mission may have completed all work before an older AI summary hit quota.
    if (
      config.mode === 'build' &&
      config.collaboration === 'economy' &&
      session.tasks.length &&
      session.tasks.every((task) => task.status === 'done')
    ) {
      this.finishEconomy(session);
      return;
    }
    const history = recentContext(session.messages);
    const memory =
      config.memoryEnabled !== false || config.personalMemoryEnabled !== false
        ? this.services.memory?.(
            config,
            `${session.progress.objective}\n${session.progress.updates.join('\n')}`
          )
        : null;
    session.context = {
      historyChars: history.length,
      memoryChars: memory?.text?.length || 0,
      selectedMemoryIds: memory?.selectedIds || [],
      personalMemoryIds: memory?.personalIds || [],
      projectMemoryIds: memory?.projectIds || [],
      totalNotes: memory?.total || 0,
    };
    const common = `USER REQUEST: ${session.progress.objective}\nUSER CLARIFICATIONS: ${session.progress.updates.join('\n')}\nProject: ${config.project}\nPROJECT BRIEF: ${config.projectBrief || '(none)'}\n${memory?.text || ''}\n`;
    const base = `${common}RECENT CONTEXT: ${history}\n`;
    const workBase = config.collaboration === 'economy' ? common : base;
    if (this.active.budget && config.collaboration === 'economy' && config.mode === 'build') {
      this.status(session, 'Vérification budgets + quotas');
      await Promise.all(
        ['codex', 'claude'].map((agent) => this.active.budget.quota(agent, this.providers[agent]))
      );
      this.active.preflightQuotas = new Set(['codex', 'claude']);
    }
    let gpt = '',
      claude = '';
    if (
      session.progress.stage === 'analysis' &&
      (config.collaboration !== 'economy' || config.mode === 'discuss')
    ) {
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
    for (
      let round = 0;
      round <
      (session.progress.stage !== 'analysis' || config.collaboration === 'economy'
        ? 0
        : config.rounds);
      round++
    ) {
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
    let planText = session.progress.planText;
    if (!session.tasks.length) {
      this.status(session, 'Répartition des tâches');
      session.progress.stage = 'plan';
      planText = await this.ask(
        session,
        config,
        'codex',
        'Plan',
        `${base}Codex: ${gpt}\nClaude: ${claude}\nReturn ONLY valid JSON: {"summary":"...","tasks":[{"title":"...","owner":"codex or claude","files":["relative paths"],"acceptance":"..."}]}. At most 8 concrete tasks. Prefer few coherent tasks to reduce coordination overhead. Assign tasks to both agents when appropriate. Tasks execute sequentially in this shared project. No commit/push tasks. ${config.sshProfileId ? 'SSH deployment tasks only if explicitly requested to selected connection.' : 'No deploy tasks.'} If blocked on user input or wrong/missing project sources, return ONLY {"status":"waiting_user","question":"specific missing input or folder","options":[]} instead of inventing tasks.`
      );
      const plan = extractJson(planText);
      session.tasks = normalizeTasks(plan);
      session.progress.planText = planText;
      session.progress.stage = 'tasks';
      this.save();
      this.event(session, 'tasks', { tasks: session.tasks });
    }
    for (const task of session.tasks) {
      if (task.status === 'done') continue;
      this.active.taskId = task.id;
      if (this.active.controller.signal.aborted) throw new Error('Arrêt demandé.');
      task.checkpoint ||= task.status === 'review' ? 'review' : 'implement';
      const reviewer = task.owner === 'codex' ? 'claude' : 'codex';
      if (task.checkpoint === 'implement') {
        this.active.budget?.capacity(2, 'construction + relecture');
        task.status = 'running';
        this.save();
        this.event(session, 'tasks', { tasks: session.tasks });
        this.status(session, `${task.owner === 'codex' ? 'Codex' : 'Claude'} · ${task.title}`);
        task.report = await this.ask(
          session,
          config,
          task.owner,
          'Construction',
          `${workBase}Shared plan: ${planText}\nTask assigned to you: ${JSON.stringify(taskBrief(task))}\nCompleted work: ${completedWork(session.tasks)}\nObserved changes: ${JSON.stringify(session.recap?.changes || [])}\nImplement this task now. Inspect partial work first on resumption. Use shared tools and consult partner when useful. Summarize actual modifications and validations.`,
          true
        );
        task.checkpoint = 'review';
        this.save();
      }
      const reviewNow = async (final = false) => {
        task.status = 'review';
        this.status(session, `${reviewer === 'codex' ? 'Codex' : 'Claude'} relit ${task.title}`);
        // Include observed changes, even when a model omitted them from its plan.
        const paths = [
          ...new Set([...task.files, ...(session.recap?.changes || []).map((entry) => entry.path)]),
        ].slice(0, 20);
        const snapshot = this.evidence.capture(config.project, { ...task, files: paths });
        task.reviewEvidence = this.evidence.summary(snapshot);
        this.save();
        this.event(session, 'tasks', { tasks: session.tasks });
        const text = await this.ask(
          session,
          config,
          reviewer,
          final ? 'Relecture finale' : 'Relecture',
          `${workBase}${final ? 'Review actual files again after correction for ' : 'Review actual current files for this task: '}${JSON.stringify(taskBrief(task))}\n${this.evidence.text(snapshot)}Implementer report: ${reportExcerpt(task.report)}\nRemote operations: ${JSON.stringify((session.results || []).filter((entry) => entry.remote).slice(-10))}\nReturn ONLY JSON {"approved":true or false,"summary":"...","issues":["actionable issues"]}. Check against request and acceptance criteria. Do not modify files. Missing user choice is waiting_user, never a defect requiring another correction. If blocked return {"status":"waiting_user","question":"...","options":[]}.`
        );
        const changed = this.evidence.changed(snapshot),
          blocked = snapshot.files
            .filter((file) => file.status === 'blocked')
            .map((file) => file.path);
        if (changed.length || blocked.length) {
          task.status = 'attention';
          session.state = 'attention';
          this.message(
            session,
            'system',
            'Relecture à vérifier',
            changed.length
              ? `Fichiers changés pendant relecture : ${changed.join(', ')}. Validation arrêtée. Revoir diff.`
              : `Fichiers non vérifiables : ${blocked.join(', ')}. Revoir chemins + permissions.`
          );
          return null;
        }
        task.review = text;
        return extractJson(text);
      };
      let verdict;
      if (task.checkpoint === 'review') {
        verdict = await reviewNow();
        if (session.state === 'attention') return;
        if (verdict?.approved === false) {
          task.checkpoint = 'correct';
          this.save();
        }
      }
      if (task.checkpoint === 'correct') {
        task.status = 'running';
        this.save();
        this.event(session, 'tasks', { tasks: session.tasks });
        task.report = await this.ask(
          session,
          config,
          task.owner,
          'Correction',
          `${workBase}Fix these review issues in your assigned task: ${task.review || ''}\nTask: ${JSON.stringify(taskBrief(task))}. Inspect existing changes before proceeding. Report actual changes and validation.`,
          true
        );
        task.corrections = (task.corrections || 0) + 1;
        task.checkpoint = 'review_final';
        this.save();
      }
      if (task.checkpoint === 'review_final') {
        verdict = await reviewNow(true);
        if (session.state === 'attention') return;
      }
      task.status = verdict?.approved === true ? 'done' : 'attention';
      if (task.status === 'done') task.checkpoint = 'done';
      this.save();
      this.event(session, 'tasks', { tasks: session.tasks });
      if (task.status === 'attention') {
        session.state = 'attention';
        this.message(
          session,
          'system',
          'Relecture à vérifier',
          'Relecture non validée. Travail conservé. Consulter échanges + diff puis préciser correction souhaitée.'
        );
        return;
      }
    }
    session.progress.stage = 'summary';
    this.save();
    if (config.collaboration === 'economy') {
      this.finishEconomy(session);
      return;
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
  finishEconomy(session) {
    session.progress.stage = 'summary';
    this.status(session, 'Bilan commun');
    this.recap(session);
    session.efficiency ||= { summaryCallsAvoided: 0 };
    session.efficiency.summaryCallsAvoided = 1;
    this.message(session, 'system', 'Bilan observé', localSummary(session));
  }
  stop() {
    if (this.active) {
      this.active.userStopped = true;
      this.active.controller.abort();
    }
  }
}
module.exports = { Orchestrator, extractJson, normalizeTasks };
