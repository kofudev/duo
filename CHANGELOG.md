# Duo 0.4.1 · 2026-10-10

- Première publication publique : guides français/anglais, contribution, sécurité, architecture et vérifications documentées.
- Site statique français pour duo.varelia.fr, parcours illustratif interactif et téléchargements Windows.
- CI Windows, actions épinglées, construction manuelle et archives publiques sans profils ni rapports locaux.
- Licences et ressources d’origine conservées ; données personnelles exclues des sources distribuées.

# Duo 0.4.0 · 2026-10-10

- Mémoire personnelle commune à Codex et Claude, dans tous projets ; activation par projet distincte des checkpoints projet.
- Import texte/Markdown/JSON avec aperçu modifiable, sélection, épingles, doublons et limites ; export mémoire JSON réimportable. Guide transfert ChatGPT/Claude. Import sans inférence.
- Contexte ciblé : quatre notes personnelles / 2 500 caractères + six notes projet / 4 500 caractères ; mêmes extraits pour les deux agents.
- Durée facultative, désactivée par défaut. Quotas, appels et tokens conservent leurs limites. Affichage durée libre dans mission et planification.
- Réglages Claude indiquent version CLI requise dans modèles grisés, dont Opus 5.5.
- Schéma V4 avec sauvegarde V3 ; versions antérieures refusent nouvel historique.

# Duo 0.3.0 · 2026-10-10

- Pilotage : durée maximale, appels/tokens mission, réservations prudentes, ledger commun sur 24 h. Pause préserve modifications. Quotas Codex relus avant appels ; mode strict bloque quota absent.
- Planification locale : départ à heure choisie, réglages et projet figés, queue séquentielle, annulation, départ manqué après 15 min, reprise sans replay après redémarrage. Duo ouvert et Windows éveillé nécessaires.
- Mémoire projet : notes/tags/épingles, récupération ciblée et bornée, checkpoints sans appel IA supplémentaire, historique récent raccourci.
- Mode économe par défaut conserve répartition + relecture partenaire et retire débats systématiques. Mode complet disponible.
- 19 skills visibles : deux nouveaux skills Duo courts + trois références Context Engineering MIT avec provenance.
- Schéma V3 protège mémoire/ledger/planifications contre chargement destructeur par ancienne version. Sauvegarde V2 lors migration.

# Duo 0.2.0 · 2026-10-10

- Windows app : workspace/project creation, GitHub clone, isolated Git worktrees, move/relink/archive/restore.
- Real CLI model catalogs, compatible effort settings, subscription auth detection, quota display for Codex.
- Fourteen visible bundled skills, Caveman intensity, personal skill creation/import/editing, project skill opt-in.
- Project editor with syntax highlighting, drafts across navigation, external change detection, guarded saves, Ctrl P search and keyboard tabs.
- Persistent observed tool journal, SHA-256 file snapshots before peer review, shared plans and readable review verdicts.
- Markdown export with conversation, review evidence, tools and provider token metrics including caches.
- Atomic history with recovery snapshots, startup errors, size bounds and single instance per profile.
- Native UI, process/Git/storage tests, WCAG axe-core audits and packaged/installed app checks.

Claude account login still required on this test machine. Live Codex read-only inference verified; a live two-provider construction has not been verified. Interactive terminal, multimodal attachments, cloud projects and a general MCP connector catalog remain outside this version.
