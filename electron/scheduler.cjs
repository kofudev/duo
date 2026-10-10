const { randomUUID } = require('node:crypto');

class Scheduler {
  constructor(jobs, { launch, available, save, notify, now = Date.now }) {
    Object.assign(this, { jobs, launch, available, save, notify, now });
    this.dispatching = false;
  }
  add({ prompt, dueAt, projectId, sessionId, config }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 60000)
      throw new Error('Prompt planifié requis, maximum 60 000 caractères.');
    if (
      !Number.isFinite(dueAt) ||
      dueAt < this.now() + 10000 ||
      dueAt > this.now() + 366 * 86400000
    )
      throw new Error('Départ : dans 10 secondes à 366 jours.');
    if (this.jobs.filter((job) => job.state === 'scheduled').length >= 50)
      throw new Error('50 missions planifiées maximum.');
    const job = {
      id: randomUUID(),
      prompt: prompt.trim(),
      dueAt,
      projectId,
      sessionId,
      config,
      state: 'scheduled',
      createdAt: this.now(),
    };
    // Keep pending jobs and at most 150 old jobs.
    const old = this.jobs
      .filter((job) => job.state !== 'scheduled')
      .sort((a, b) => a.createdAt - b.createdAt);
    while (this.jobs.length >= 200 && old.length) {
      const index = this.jobs.indexOf(old.shift());
      if (index >= 0) this.jobs.splice(index, 1);
    }
    this.jobs.push(job);
    this.save();
    this.notify();
    return job;
  }
  cancel(id) {
    const job = this.jobs.find((job) => job.id === id);
    if (!job || job.state !== 'scheduled')
      throw new Error('Seule mission en attente peut être annulée.');
    job.state = 'cancelled';
    this.save();
    this.notify();
    return job;
  }
  async tick() {
    if (this.dispatching || !this.available()) return;
    const job = this.jobs
      .filter((job) => job.state === 'scheduled' && job.dueAt <= this.now())
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!job) return;
    if (this.now() - job.dueAt > 15 * 60000) {
      job.state = 'missed';
      job.error = 'Départ manqué de plus de 15 min. Replanifier explicitement.';
      this.save();
      this.notify();
      return;
    }
    this.dispatching = true;
    try {
      job.state = 'starting';
      this.save();
      this.notify();
      await this.launch(job);
      if (job.state === 'starting') job.state = 'running';
      job.startedAt = this.now();
    } catch (error) {
      job.state = 'blocked';
      job.error = error.message;
    } finally {
      this.dispatching = false;
      this.save();
      this.notify();
    }
  }
  complete(session) {
    const job = this.jobs.find(
      (job) => ['starting', 'running'].includes(job.state) && job.sessionId === session.id
    );
    if (!job) return;
    job.state = session.state;
    job.completedAt = this.now();
    if (session.stopReason) job.error = session.stopReason.message;
    this.save();
    this.notify();
  }
  start() {
    this.timer = setInterval(() => this.tick().catch((error) => this.notify(error.message)), 1000);
    this.timer.unref();
  }
  close() {
    clearInterval(this.timer);
  }
}
module.exports = { Scheduler };
