import React, { useState } from 'react';
import {
  Layers,
  Search,
  Plus,
  FolderOpen,
  Check,
  ExternalLink,
  FileText,
  MessageSquare,
  Code2,
  Eye,
  Sparkles,
  ShieldCheck,
  Bug,
  BookOpen,
  GitCommitHorizontal,
  FlaskConical,
  Loader2,
  RefreshCw,
  Pencil,
} from 'lucide-react';
import { Modal, Empty } from './ui';
const api = window.duo;
const icons = {
  caveman: MessageSquare,
  engineering: Code2,
  review: Eye,
  'ui-ux-pro-max': Sparkles,
  debugging: Bug,
  accessibility: ShieldCheck,
  architecture: Layers,
  documentation: BookOpen,
  'caveman-commit': GitCommitHorizontal,
  'caveman-review': Eye,
  'frontend-design': Sparkles,
  'webapp-testing': FlaskConical,
};
export default function SkillsView({
  skills,
  config,
  changeConfig,
  perform,
  setSkills,
  projectName,
  notify,
}) {
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState('Tous'),
    [detail, setDetail] = useState(null),
    [creating, setCreating] = useState(false),
    [working, setWorking] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', instructions: '' });
  const visible = skills.filter(
    (skill) =>
      !skill.hidden &&
      (category === 'Tous' || skill.category === category) &&
      `${skill.name} ${skill.description} ${skill.category}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const categories = ['Tous', ...new Set(skills.map((s) => s.category))];
  const toggle = (skill) => {
    if (!skill.invalid)
      changeConfig({
        skills: config.skills.includes(skill.id)
          ? config.skills.filter((id) => id !== skill.id)
          : [...config.skills, skill.id],
      });
  };
  const importSkill = async () => {
    setWorking(true);
    try {
      const result = await perform(() => api.importSkill());
      if (result) {
        setSkills(result.skills);
        notify('Skill importé. Lire instructions puis activer.');
      }
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="skills-page">
      <div className="page-heading">
        <div>
          <h1>Skills</h1>
          <p>
            {config.skills.length} activés · {projectName || 'Réglages par défaut'}
          </p>
        </div>
        <div className="page-actions">
          <button
            className="secondary-button"
            disabled={working}
            onClick={async () => {
              const result = await perform(() => api.library());
              if (result) {
                setSkills(result.skills);
                notify('Skills actualisés.');
              }
            }}
          >
            <RefreshCw size={15} />
            Actualiser
          </button>
          <button className="secondary-button" disabled={working} onClick={importSkill}>
            <FolderOpen size={15} />
            Importer
          </button>
          <button
            className="primary-button"
            disabled={working}
            onClick={() => {
              setEditingSkill(null);
              setForm({ name: '', description: '', instructions: '' });
              setCreating(true);
            }}
          >
            <Plus size={15} />
            Créer skill
          </button>
        </div>
      </div>
      <div className="skill-controls">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Rechercher skills"
            placeholder="Design, Git, debugging…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field inline">
          Activation
          <select
            aria-label="Activation skills"
            value={config.skillMode || 'auto'}
            onChange={(e) => changeConfig({ skillMode: e.target.value })}
          >
            <option value="auto">Selon tâche</option>
            <option value="manual">Tous sélectionnés</option>
          </select>
        </label>
      </div>
      <div className="category-tabs" aria-label="Catégories skills">
        {categories.map((value) => (
          <button
            key={value}
            className={category === value ? 'active' : ''}
            onClick={() => setCategory(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="caveman-setting">
        <MessageSquare size={20} />
        <div>
          <strong>Caveman</strong>
          <p>Code, erreurs, noms et chiffres préservés.</p>
        </div>
        <label className="field inline">
          Intensité
          <select
            aria-label="Intensité Caveman"
            value={config.cavemanLevel || 'full'}
            onChange={(e) => changeConfig({ cavemanLevel: e.target.value })}
          >
            <option value="lite">Lite · court, phrases complètes</option>
            <option value="full">Full · dense</option>
            <option value="ultra">Ultra · minimum mots</option>
          </select>
        </label>
      </div>
      <div className="skills-grid">
        {visible.map((skill) => {
          const Icon = icons[skill.id] || Layers,
            enabled = config.skills.includes(skill.id);
          return (
            <article key={skill.id} className={skill.invalid ? 'invalid' : ''}>
              <div className="skill-head">
                <span className="skill-icon">
                  <Icon size={21} />
                </span>
                <button
                  className={`toggle ${enabled ? 'on' : ''}`}
                  aria-label={`Activer ${skill.name}`}
                  aria-pressed={enabled}
                  disabled={!!skill.invalid}
                  onClick={() => toggle(skill)}
                />
              </div>
              <small>
                {skill.category} ·{' '}
                {skill.origin === 'bundled'
                  ? skill.author || 'Officiel'
                  : skill.origin === 'project'
                    ? 'Projet'
                    : 'Personnel'}
              </small>
              <h2>{skill.name}</h2>
              <p>{skill.invalid || skill.description}</p>
              <span className="skill-status">
                {enabled ? (
                  <>
                    <Check size={13} />
                    Activé pour ce projet
                  </>
                ) : (
                  'Désactivé'
                )}
              </span>
              <div className="skill-footer">
                <button
                  className="text-link"
                  disabled={!!skill.invalid}
                  onClick={async () => {
                    const result = await perform(() => api.skillDetail(skill.id));
                    if (result) setDetail(result);
                  }}
                >
                  <FileText size={13} />
                  Instructions
                </button>
                {skill.source && (
                  <button
                    className="text-link"
                    onClick={() => perform(() => api.openUrl(skill.source))}
                  >
                    Source <ExternalLink size={12} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <Empty icon={Search} title="Aucun skill trouvé">
          <p>Changer filtre ou créer skill personnel.</p>
        </Empty>
      )}
      <div className="info-note">
        <Layers size={17} />
        <span>
          Instructions partagées avec deux IA. Mode « Selon tâche » charge ressources utiles. UI/UX
          Pro Max inclut scripts + données. Python 3 requis pour recherche.
        </span>
      </div>
      {detail && (
        <Modal title={detail.name} close={() => setDetail(null)} wide>
          <div className="skill-detail-meta">
            <span>{detail.license || 'Licence non précisée'}</span>
            <span>
              {detail.revision
                ? `Révision ${detail.revision.slice(0, 8)}`
                : detail.origin === 'personal'
                  ? 'Skill personnel'
                  : 'Ressource locale'}
            </span>
          </div>
          <p className="modal-intro">
            Instructions réellement transmises ou lues par agents. Contraintes mission restent
            prioritaires.
          </p>
          <div className="skill-detail-actions">
            {detail.origin === 'personal' && (
              <button
                className="primary-button"
                onClick={() => {
                  setEditingSkill(detail);
                  setForm({
                    name: detail.metadata.name,
                    description: detail.metadata.description,
                    instructions: detail.body,
                  });
                  setDetail(null);
                  setCreating(true);
                }}
              >
                <Pencil size={15} />
                Modifier skill
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => perform(() => api.revealSkill(detail.id))}
            >
              <FolderOpen size={15} />
              Ouvrir dossier skill
            </button>
          </div>
          <pre className="skill-source">{detail.text}</pre>
          <button
            className="secondary-button full"
            onClick={() => perform(() => api.copy(detail.text))}
          >
            <FileText size={14} />
            Copier instructions
          </button>
        </Modal>
      )}
      {creating && (
        <Modal
          title={editingSkill ? 'Modifier skill personnel' : 'Créer skill personnel'}
          close={() => setCreating(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setWorking(true);
              try {
                const result = await perform(() =>
                  editingSkill
                    ? api.updateSkill({
                        ...form,
                        id: editingSkill.id,
                        expectedHash: editingSkill.hash,
                      })
                    : api.createSkill(form)
                );
                if (result) {
                  setSkills(result.skills);
                  setCreating(false);
                  notify(
                    editingSkill
                      ? 'Skill modifié. Changements utilisés aux prochains appels.'
                      : 'Skill créé. Activer pour projet souhaité.'
                  );
                }
              } finally {
                setWorking(false);
              }
            }}
          >
            <label className="field">
              Identifiant
              <input
                autoFocus
                required
                readOnly={!!editingSkill}
                value={form.name}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9-]*"
                onChange={(e) => setForm((old) => ({ ...old, name: e.target.value }))}
                placeholder="ma-relecture-python"
              />
            </label>
            <label className="field">
              Quand utiliser
              <input
                required
                value={form.description}
                maxLength={1000}
                onChange={(e) => setForm((old) => ({ ...old, description: e.target.value }))}
                placeholder="Utiliser pour relire code Python et ses tests."
              />
            </label>
            <label className="field">
              Instructions
              <textarea
                aria-label="Instructions"
                required
                rows={8}
                value={form.instructions}
                maxLength={50000}
                onChange={(e) => setForm((old) => ({ ...old, instructions: e.target.value }))}
                placeholder="Étapes, critères, ressources utiles…"
              />
            </label>
            <p className="modal-intro">
              Enregistré sur ordinateur au format SKILL.md.{' '}
              {editingSkill
                ? 'Activation actuelle conservée.'
                : 'Désactivé jusqu’à votre sélection.'}
            </p>
            <button className="primary-button full" disabled={working}>
              {working ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}
              {editingSkill ? 'Enregistrer skill' : 'Créer skill'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
