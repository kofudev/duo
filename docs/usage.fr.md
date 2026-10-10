# Duo · Windows · 0.5.0

Un prompt → Codex + Claude. Analyses simultanées → discussion croisée → plan partagé → écritures séquentielles → relecture partenaire.

Application personnelle locale. Electron + React. CLI officiels installés sur ordinateur gèrent connexion. Duo ne propose aucun formulaire OAuth et ne collecte aucun mot de passe ou jeton.

## Installer et connecter

1. Télécharger puis ouvrir `Duo-Setup-0.5.0.exe` depuis [GitHub Releases](https://github.com/kofudev/duo/releases/latest). Installation Windows x64, dossier configurable. Installateur non signé.
2. Installer CLI officiels [Codex](https://learn.chatgpt.com/docs/cli), [Claude Code](https://code.claude.com/docs/en/setup) et Git. Node.js reste requis pour lanceurs npm JavaScript. Versions natives prises en charge.
3. Connecter comptes dans PowerShell :

```powershell
codex login
claude auth login
```

4. Duo → Connexions → Actualiser. Deux IA connectées nécessaires pour mission commune.
5. Projets → importer dossier ou créer projet. Écrire demande. Ctrl + Entrée lance mission.

GitHub facultatif : installer `gh`, exécuter `gh auth login`, puis actualiser Connexions. Commandes mise à jour copiables depuis app ; aucune installation globale automatique.

CLI hors PATH : copier commande connexion depuis Duo. Chemin complet fourni pour installations natives détectées.

Version portable : conserver **dossier complet** `release/win-unpacked`, puis ouvrir `Duo.exe`. Exécutable seul ne suffit pas. Vérifié sur Windows 11 x64.

## Missions

**Discuter** : propositions et critique en lecture seule, puis synthèse. **Construire** : huit tâches maximum, responsabilité Codex/Claude, construction séquentielle, relecture autre agent. Une correction maximum par tâche ; relecture non validée → « À vérifier », tâches suivantes suspendues.

Mode économe par défaut : Discuter = deux avis + synthèse ; Construire = plan direct puis tâches et relectures. Mode complet ajoute deux propositions et 1 à 5 tours de débat. Un écrivain IA à la fois. Arrêter accessible depuis autres pages. Nouvelle mission possible après fin ou annulation. Missions renommables, recherchables, archivables et restaurables.

Avant relecture, coordonnateur lit fichiers déclarés du plan, fournit snapshot borné et empreinte SHA-256. Fichier changé pendant relecture → validation arrêtée. Extraits volumineux exigent inspection complémentaire par agent. `.env`, clés privées, fichiers nommés secrets/credentials et métadonnées Git ne sont pas copiés automatiquement. Cette exclusion ne détecte pas tous secrets présents dans code.

Journal conserve 500 invocations outils récentes. Invocation annoncée n’est pas preuve de réussite. Rapports indiquent validations effectuées. Export Markdown comprend conversation, plan, empreintes, compteurs et journal.

## Reprise et échanges entre agents

Chaque mission conserve objectif initial, précisions, plan et étape. Arrêt ou redémarrage → reprise manuelle, aucune exécution rejouée automatiquement. Une relecture interrompue reprend sans répéter construction. Une écriture interrompue exige inspection du travail partiel avant continuation.

Information manquante → carte À vous de répondre. Répondre à question ; CONTINUE seul ne dépense aucun nouvel appel. Si dossier choisi est incorrect, Choisir autre dossier pour mission garde objectif et historique, avant toute modification. Après discussion, Construire à partir de cet échange autorise explicitement écriture sur même objectif.

Les agents disposent du même tableau de mission et peuvent envoyer messages ou consulter réellement partenaire pendant travail. Question et réponse apparaissent avec destinataire. Consultation reste lecture seule, compte dans budgets, ne peut se répéter récursivement et reste limitée à trois par tâche.

Récapitulatif observé compare fichiers avec début mission. Il inclut changements extérieurs éventuels, exclut dépendances, sorties générées, secrets usuels et liens. Gros fichiers suivent métadonnées ; couverture limitée signalée. Commandes affichent code reçu ou résultat non fourni.

Connexion serveur : [guide SSH](ssh.fr.md).

## Pilotage, durée et quotas

Pilotage & mémoire → **durée libre par défaut**. Activer limite de durée pour choisir 1 à 1 440 minutes. Sans minuterie, fin quand objectif terminé, budget atteint ou arrêt manuel ; aucune coupure horaire de mission. Appels maximum, budget tokens, réservations et plafonds locaux sur 24 h restent actifs. Les CLI gardent leurs délais techniques par appel. Ex. limite 180 minutes = jusqu'à trois heures, fin anticipée possible.

Réserve fournisseur par défaut : 20 %. Codex : fenêtres compte relues avant phases ; réserve atteinte → pause avant nouvel appel. Mode strict exige quota connu des deux fournisseurs avant mission. Claude sans télémétrie disponible → strict bloque mission entière. Mode disponible autorise budgets locaux avec avertissement.

**Impossible garantir jamais atteindre quota** : activité autres applis, lecture retardée et consommation appel en cours. Plafond tokens = seuil d'interruption + réservation, consommation réelle peut le dépasser. Arrêt demande annulation aux CLI ; quelques secondes possibles avant fin processus. Tokens cache comptés lorsqu'exposés. Les prix API ne donnent pas coût abonnement.

Ledger usage conservé dans profil Duo, commun à tous projets. Appel échoué/interrompu ou usage non fourni → réservation conservée par prudence. Historique 24 h glissantes. Les valeurs des plafonds utilisées sont celles de mission ; modifier plafond ne rembourse pas usage passé.

Budget atteint → mission en pause, fichiers conservés, aucun appel de bilan supplémentaire. Tâches validées restent visibles ; travail interrompu pendant écriture/relecture demande vérification. Le bouton Reprendre reprend dernière étape après inspection des changements. Tâches validées ne sont pas réécrites et compteurs restent cumulatifs ; augmenter plafond si nécessaire ne rembourse pas consommation.

## Planification locale

Bouton calendrier du compositeur ou Pilotage → Planifier. Choisir heure locale et demande. Projet, modèles, efforts, skills et budgets enregistrés dans mission. **Duo doit rester ouvert et Windows éveillé.** Aucune tâche système Windows créée.

Une seule mission à la fois. Projet d'origine conservé même si autre projet sélectionné. Retard supérieur à 15 minutes → départ manqué sans lancement. Authentification manquante, projet archivé, brouillons non enregistrés dans projet cible → bloquée. Redémarrage n'exécute pas de nouveau une mission déjà lancée/interrompue. Annuler possible pour départ en attente.

## Mémoire personnelle commune

Pilotage & mémoire → Mémoire personnelle · partagée. Profil local commun à tous projets et aux deux fournisseurs, séparé des notes projet. Jusqu'à 200 notes éditables, 1 600 caractères chacune. Importer texte/Markdown/JSON mémoire Duo depuis ChatGPT, Claude ou fichier local choisi ; aperçu modifiable, exclusion des notes, épingles, validation explicite. Doublons ignorés sans écraser notes existantes. Import local sans inférence. Export JSON réimportable pour sauvegarde. Archives ZIP ou JSON complet des conversations non pris en charge.

Quatre notes personnelles maximum / 2 500 caractères réservés, notes épinglées prioritaires puis pertinence de demande. Les deux agents reçoivent exactement même contexte mémoire sélectionné. Chaque projet peut désactiver ce partage sans supprimer profil. Préférences importantes → épingler ; pas nécessaire relire toute mémoire à chaque appel. Contrôle mémoire projet indépendant. Aucun checkpoint ne modifie automatiquement profil personnel.

Mémoire des chats web ne suit pas automatiquement connexion CLI. [OpenAI distingue mémoire ChatGPT web et mémoire Codex locale](https://learn.chatgpt.com/docs/customization/memories). [Claude propose transfert mémoire en texte](https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude). Guide intégré + prompt export à copier ; relire réponse, export conversationnel pouvant rester incomplet. Rien lu automatiquement dans comptes web. Lancer mission transmet extraits sélectionnés aux deux fournisseurs.

## Échanges visibles

Chat affiche réponses en direct avec auteur et phase. Journal outils, tâches et relectures restent consultables. Mode Complète = deux propositions + débats croisés avant plan. Mode Économe = plan direct, répartition et relecture partenaire pour construction ; deux avis + synthèse pour discussion. Raisonnement interne complet des modèles n'est pas exposé par ces CLI.

## Mémoire projet

Notes éditables : titre, texte (1 600 caractères), tags, épingle. Maximum 200 notes par projet. Fin de mission → checkpoint local depuis demande, état, tâches, chemins et verdicts de relecture. Checkpoint ne certifie pas tests et peut devenir obsolète.

Recherche locale lexicale pondérée : jusqu'à 6 notes projet / 4 500 caractères, épingles prioritaires. Historique récent jusqu'à 6 messages / 7 000 caractères. Pas de résumé IA facturé, embeddings ou serveur mémoire externe. Anciennes notes signalées après 30 jours ; consigne de vérifier fichiers actuels. Désactiver mémoire empêche injection et nouveaux checkpoints ; notes déjà sauvegardées restent consultables.

Skills Project Memory + Quota Efficiency courts actifs par défaut. Trois skills Context Engineering MIT disponibles sur demande avec références/scripts d'origine, pas injectés automatiquement. Ces références conservent les instructions, scripts et licences de leurs auteurs. Voir [les attributions](../THIRD_PARTY.md).

## Workspaces et projets

Workspace regroupe projets. Chaque projet possède brief, modèles, efforts, skills et permissions commandes distincts. Brief transmis aux deux agents. Création : dossier vide, page web statique ou Node.js 22. Git initialisable sur branche `main`, sans commit automatique.

Importer conserve dossier choisi, même dans dépôt Git parent. Déplacer projet vers autre workspace conserve historique et réglages. « Rechoisir dossier déplacé » reconnecte dossier après déplacement externe. Archiver modifie métadonnées ; fichiers restent présents.

Clonage GitHub : URL HTTPS `github.com/propriétaire/dépôt` ou `propriétaire/dépôt`. Catalogue de 100 dépôts via compte `gh`. Destination neuve obligatoire. Worktree : branche distincte, dossier distinct, brief et réglages repris. Modifications non committées restent dans checkout source. Annulation peut conserver dossier partiel à inspecter.

## Modèles et efforts

Codex : catalogue réel `model/list`, entrées masquées incluses. Efforts proviennent du CLI. Effort maximal compatible sélectionné au premier chargement ; choix ensuite enregistré par projet.

Claude : métadonnées `supportedModels()` via SDK officiel, initialisation sans prompt utilisateur ; versions documentées complètent catalogue. Alias, versions précédentes, exigences mise à jour, niveaux d’effort affichés. ID personnalisé possible ; capacités à vérifier. Effort automatique quand modèle ne propose aucun réglage.

Catalogue annoncé ne garantit pas accès abonnement. Compte, organisation, version CLI et fournisseur décident accès final. Modèles/fonctions des chats web absents des CLI ne sont pas exposés ici.

Fable et alias pouvant utiliser crédits supplémentaires nécessitent activation explicite. Désactivé par défaut. Quotas abonnements applicables. Quotas Codex affichés depuis compte réel. Claude n’expose pas quotas compte ici. Compteurs mission proviennent des réponses CLI, tokens cache inclus lorsqu’exposés ; aucune estimation monétaire.

## Skills

19 skills visibles + Ultracave : Caveman, Caveman Review, Caveman Commit, UI/UX Pro Max, Frontend Design, Webapp Testing, React Best Practices, React Composition, Engineering, Relecture croisée, Debugging, Accessibilité, Architecture projet, Documentation utile, Project Memory, Quota Efficiency, Memory Systems, Context Compression, Context Optimization.

Actifs par défaut : Caveman, Engineering, Relecture croisée, UI/UX Pro Max, Debugging, Accessibilité, Project Memory, Quota Efficiency. Migration V1/V2 conserve sélection existante. Caveman Lite / Full / Ultra réglable. Préférence utilisateur prioritaire ; code, noms, chemins, chiffres et négations préservés.

« Selon tâche » charge ressources pertinentes progressivement. « Tous sélectionnés » active chaque skill coché. Manifeste réel, origine et licence consultables. Skills personnels créables, importables, modifiables. Édition refuse écrasement après changement externe. Import copie ressources, sans exécution ni installation globale.

Skills projet découverts dans `.agents/skills`, `.claude/skills`, `.duo/skills`, désactivés jusqu’à sélection. Format : dossier en minuscules + `SKILL.md`, en-tête YAML `name` et `description`.

UI/UX Pro Max complet : scripts, données, références. Python 3 requis pour recherches ; phases lecture seule n’exécutent pas scripts. Agents peuvent lire ressources. Provenance et licences : [THIRD_PARTY.md](../THIRD_PARTY.md).

## Éditeur et Git

Explorateur + onglets + CodeMirror : JavaScript/TypeScript, JSON, HTML, CSS, Markdown, Python. Ctrl + S enregistre. Ctrl + P cherche fichier depuis toute page ; noms partiels, sous-dossiers et accents pris en charge. Recherche bornée : 20 000 éléments / 1 500 dossiers / 100 résultats.

UTF-8 limité à 500 Ko ; BOM et fins de ligne conservés. Liens/jonctions non suivis par éditeur. Fichiers à liens physiques multiples non modifiables. Brouillons restent en mémoire pendant navigation entre pages/projets. Fichiers propres actualisés sur changement externe ; brouillon modifié conservé avec avertissement. Sauvegarde refuse empreinte devenue obsolète. Éditeur en lecture seule pendant opération. Construction bloquée si projet actif possède brouillons non enregistrés.

Fermer app demande confirmation si brouillons présents. **Brouillons ne survivent pas à fermeture ou crash** : enregistrer avant quitter. Maximum 50 onglets par projet.

Onglets clavier : ← →, Début, Fin changent fichier ; Suppr ferme onglet sélectionné. Bouton « Fermer fichier actif » disponible dans barre éditeur.

Git : branche, fichiers du projet choisi, diff, commit des seuls chemins sélectionnés, push confirmé avec dépôt/branche/distant. Index autres fichiers préservé. Aperçu obsolète → commit refusé. Renommage traversant frontière projet → commit refusé. Push publie tous commits locaux de branche, y compris dans dépôt parent indiqué. Identité Git et suivi distant nécessaires.

## Données et récupération

Historique : `%APPDATA%/Duo/workspace.json`. Skills personnels : `%APPDATA%/Duo/skills`. Stockage local en texte clair. Prompts, contexte et contenus projet consultés transmis aux deux fournisseurs pour mission commune.

Sauvegardes atomiques, copie précédente et snapshots récupération si verrou Windows. Redémarrage choisit snapshot valide récent. Historique corrompu conservé pour inspection ; schéma plus récent refusé sans écrasement. Migration schéma V1/V2/V3 vers V4 avec sauvegarde antérieure. Duo 0.3 et versions précédentes refusent V4 : conserver nouvelle version après migration. Une instance par profil. Historique limité à 100 Mo. Missions interrompues deviennent arrêtées après redémarrage.

Claude reçoit outils nécessaires. Shell activable dans Réglages pour construction. Hooks et MCP hérités désactivés pour invocations Duo ; fichiers de configuration restent présents. Codex utilise sandbox lecture seule ou écriture projet, sans approbation silencieuse d’escalade. Inspection Codex peut employer commandes ; scripts/tests interdits dans phases lecture seule par consigne. Politiques CLI restent applicables.

Implémenté : collaboration de code, projets, skills, éditeur, GitHub. Terminal interactif, pièces jointes multimodales, cloud, gestion PR/issues et catalogue MCP intégré non implémentés. Duo n’est pas produit OpenAI ou Anthropic. Usage abonnement passe par binaire officiel non modifié et connexion propre utilisateur ; distribution commerciale soumise aux [conditions Anthropic](https://code.claude.com/docs/en/legal-and-compliance).

## Développer et vérifier

Node.js 24 LTS et npm. Electron 44.4.1. `npm ci` peut télécharger composants natifs SDK ; non embarqués, Duo utilise Claude CLI installé séparément.

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:mission
npm run test:pilot
npm run test:a11y
npm run dist
npm run test:packaged
```

Tests UI nécessitent build récent (`npm run build`). Mission smoke utilise CLI fixtures locaux, aucun modèle distant. Audit axe-core vérifie écrans principaux ; Pilotage audité séparément ; contrôles automatiques ne remplacent pas revue humaine. Test Codex réel opt-in : `$env:DUO_ALLOW_REAL_AI = 'true'`, puis `node tests/real-codex-smoke.cjs` ; consomme quota abonnement. Validation et limites constatées : [validation](validation.md).

## Sources officielles

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Claude CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude modèles et effort](https://code.claude.com/docs/en/model-config)
- [Claude authentification](https://code.claude.com/docs/en/authentication)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)

Code Duo et huit skills créés pour app : MIT. Ressources tierces conservent leurs licences.
