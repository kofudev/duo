# Duo 0.6.0 · 2026-10-11

- Accès complet explicite par projet : fichiers de l’ordinateur, commandes et réseau pendant construction. Codex et Claude utilisent leurs modes officiels ; relectures et consultations restent en lecture seule.
- Validation exécutée par Duo après les relectures : scripts npm détectés, commandes ajoutées par les agents ou contrôles personnalisés. Codes de sortie et sorties visibles, indépendants des rapports IA.
- Échec de validation → tâche de correction, relecture partenaire, puis nouvelle exécution. Cycles bornés ; budgets et droits SSH conservés. Les contrôles enregistrés ne peuvent pas être retirés par l’outil de proposition.
- Rejets de relecture corrigés jusqu’au plafond choisi. Sources modifiées par une validation relues avant conclusion ; contrôles réussis liés aux empreintes du projet.
- Une demande supplémentaire après un travail déjà relu ajoute un nouveau plan au lieu de réafficher l’ancien bilan. Résultats et droits de mission conservés au redémarrage.

# Duo 0.5.1 · 2026-10-10

- Mode économe : bilan assemblé localement depuis rapports et résultats, sans appel IA supplémentaire. Relectures conservées ; deux tâches sans correction passent de six à cinq appels.
- Transmissions compactes : objectif et critères conservés, historique général retiré après plan, extraits gardant début et fin des rapports. Les rapports complets restent visibles.
- Mémoire sélectionnée depuis objectif conservé à la reprise, au lieu du seul message « CONTINUE ».
- Consommation par appel et par phase : entrée, sortie, cache lu/écrit et interruptions quand exposés par CLI. Aucun gain monétaire ou pourcentage tokens inventé.

# Duo 0.5.0 · 2026-10-10

- Reprise de mission depuis étape interrompue : objectif, plan, tâches validées et compteurs conservés.
- Attente utilisateur distincte des erreurs de code. CONTINUE seul ne déclenche plus boucle de relecture ; changement de dossier existant possible avant modifications.
- Outils communs aux deux CLI : tableau de mission, messages visibles et consultation technique réelle du partenaire pendant travail. Consultations bornées, en lecture seule et incluses dans budgets.
- Sortie structurée demandée aux fournisseurs pour plans et relectures. Passage explicite de discussion à construction avec objectif conservé.
- Récapitulatif de fichiers créés, modifiés et supprimés à partir de comparaison locale ; résultats de commandes et actions distantes affichés séparément.
- Connexions SSH par projet : alias ou hôte, agent ou chemin de clé OpenSSH, empreintes strictes, lecture par défaut, écriture avec empreinte et commandes distantes explicitement activées.
- Schéma V5 avec sauvegarde de migration. Actions distantes interrompues marquées résultat inconnu, à vérifier avant répétition.
- Tests des protocoles réels Codex/Claude pour outils partagés ; tests de sécurité du helper distant sur Unix. Une construction complète sur deux abonnements réels reste à valider.

# Duo 0.4.2 · 2026-10-10

- Logos Codex, Claude et GitHub issus des ressources officielles, partagés entre les écrans de l’application et le site.
- Illustrations du site et des guides actualisées ; provenance et droits des marques documentés.

# Duo 0.4.1 · 2026-10-10

- Première publication publique : guides français/anglais, contribution, sécurité, architecture et vérifications documentées.
- Site statique français pour duo.varelia.fr, parcours illustratif interactif et téléchargements Windows.
- CI Windows, actions épinglées, construction manuelle et archives publiques sans profils ni rapports locaux.
- Licences et ressources d’origine conservées ; données personnelles exclues des sources distribuées.
- Chemins Windows courts (8.3) pris en charge pour découverte de skills et contrôles d'import ; jonctions restent refusées dans les skills projet.
- Téléchargement direct de l’installateur depuis le site, avec lien permanent vers la dernière version.
- Bouton Mises à jour dans Duo : vérification explicite et téléchargement direct, sans redémarrage pendant une mission.
- Publication Windows automatique sur tag versionné ; déploiement du site après tests, par accès SSH restreint, avec bascule atomique et retour arrière en cas d’échec.

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
