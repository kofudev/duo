# Faire avancer une mission

Dans **Réglages mission**, choisir **Construire**, puis l’accès souhaité. **Accès complet** autorise fichiers hors projet, commandes et réseau avec les droits du compte Windows qui exécute Duo. L’option reste désactivée par défaut. Les réglages sont propres au projet et copiés dans chaque mission, y compris une mission planifiée.

Codex utilise `danger-full-access` pour les étapes d’écriture. Claude utilise `bypassPermissions`, avec shell et outils web. Discussion, consultation et relecture conservent leurs outils de lecture. Une politique administrateur du CLI peut refuser l’accès demandé : Duo n’essaie pas de la contourner. Ce mode ne donne pas de droits administrateur Windows supplémentaires et ne supprime pas les réserves quota. [OpenAI Docs](https://learn.chatgpt.com/docs/app-server), [permissions Claude Code](https://code.claude.com/docs/en/permissions).

Les scripts de validation utilisent aussi les droits de votre compte lorsqu’ils sont autorisés, même si leur dossier de départ est le projet. Les droits SSH restent ceux de la connexion choisie. Publication et déploiement doivent faire partie de votre demande, avec leur destination ; les agents peuvent alors utiliser ces droits. Le récapitulatif de fichiers couvre le projet sélectionné, avec ses exclusions habituelles. Les changements hors projet ne sont pas tous inventoriés.

## Des résultats observés

La validation **Automatique** conserve les scripts npm `test` et `build` détectés. Les agents peuvent ajouter jusqu’à six commandes adaptées au projet avec `duo_add_validation`. Cet outil ajoute des contrôles ; il ne retire pas les contrôles déjà enregistrés. **Mes commandes** permet de choisir jusqu’à huit lignes, par exemple :

```text
npm test
npm run build
```

Pour un projet Python ou Rust, les agents peuvent enregistrer les vérifications pertinentes en mode automatique ; vous pouvez aussi fournir `python -m pytest` ou `cargo test` vous-même. Les programmes nécessaires doivent être installés. **Désactivée** laisse les seules vérifications que les agents effectuent pendant leur travail. Commandes non autorisées ou non configurées : Duo indique explicitement qu’aucune validation centrale n’a été exécutée.

Après les tâches et leurs relectures, Duo lance les commandes, observe leurs codes de sortie et conserve leurs sorties bornées. Un rapport IA disant « réussi » ne remplace pas ces codes. Un échec crée une tâche de correction, relue par le partenaire, puis les commandes sont relancées. Deux cycles par défaut, réglables de zéro à cinq. Les rejets de relecture ont le même plafond par tâche. Les budgets restent cumulatifs et peuvent interrompre le cycle.

Une commande qui modifie des sources déclenche aussi une relecture, même avec code zéro. Le délai par commande est réglable de 10 à 900 secondes, 120 par défaut. **Arrêter** demande la fermeture de l’arbre de processus avant de libérer la mission. Les contrôles réussis sont associés aux empreintes du projet : une reprise de bilan évite de les répéter si les sources sont inchangées et la couverture du snapshot suffisante.

L’écran **Validation** montre les derniers contrôles. Le récapitulatif et l’export gardent aussi les échecs précédents. Après redémarrage, une commande en cours devient inconnue, une validation en cours devient interrompue ; aucune mission ne repart silencieusement. Décrire une nouvelle modification après un travail déjà relu crée un plan supplémentaire, en conservant les tâches terminées.

## Ce que cela permet

Duo peut poursuivre un travail au-delà d’une première tentative, partager les observations entre les deux agents et produire un bilan de fichiers et de commandes. Les sorties sont bornées, les relectures restent des jugements IA et une commande peut réussir sans couvrir toutes les exigences. Une mission s’arrête quand une information manque, quand les corrections sont épuisées ou quand un budget bloque la suite. Cette version ne démontre pas encore une meilleure qualité qu’un agent seul sur un comparatif réel.
