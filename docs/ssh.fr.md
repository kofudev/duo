# Connecter un serveur SSH

Duo peut partager une connexion SSH entre Codex et Claude. Il faut un serveur Unix avec Python 3 et le client OpenSSH sur Windows. Les clés restent dans OpenSSH : Duo enregistre le chemin du fichier, jamais son contenu ni un mot de passe.

1. Dans **Connexions → Gérer serveurs SSH**, ajouter un nom et un alias déjà présent dans `~/.ssh/config`, ou un hôte, un utilisateur et un port.
2. Indiquer un dossier existant, par exemple `/srv/mon-projet`. La racine `/` est refusée. Une clé privée peut être sélectionnée si elle n'est pas déjà chargée par l'agent SSH ou définie dans la configuration.
3. Enregistrer puis tester la connexion. Un hôte inconnu ou une empreinte changée est refusé. Pour une première connexion, utiliser OpenSSH dans PowerShell et vérifier l'empreinte auprès de l'administrateur du serveur. Duo n'accepte pas automatiquement une nouvelle clé d'hôte.
4. Cliquer **Utiliser pour ce projet**. Le nom de la connexion apparaît sous le champ de demande.

## Permissions

La lecture est le réglage initial. Les agents peuvent lister des dossiers et lire des fichiers texte. Les outils fichiers refusent les chemins hors du dossier, les liens symboliques, les liens physiques partagés et les noms de secrets usuels. Un fichier à lire ou écrire est limité à 512 Ko. Ces exclusions ne détectent pas tout secret inclus dans du code.

**Autoriser écriture de fichiers** donne accès à un outil de remplacement atomique en mode Construire. Il exige l'empreinte SHA-256 obtenue à la lecture ; `null` permet seulement la création d'un fichier absent. Les dossiers parents doivent déjà exister. Un fichier changé depuis la lecture est refusé.

**Autoriser commandes et déploiement** est une permission distincte. Elle nécessite aussi l'option **Autoriser commandes** dans les réglages de mission. Le dossier distant est alors un point de départ, **pas un sandbox** : un shell peut accéder ailleurs avec les droits de l'utilisateur SSH. Choisir un compte serveur adapté au projet. Un déploiement doit être demandé dans l'objectif de mission ; sélectionner une connexion ne lance aucun déploiement.

Les commandes durent au plus 120 secondes, avec sortie bornée. Les résultats indiquent le code de sortie effectivement reçu. Un arrêt ou une coupure réseau peut laisser un résultat inconnu : vérifier le serveur avant de répéter une écriture ou une commande. Le délai distant termine le groupe du processus lancé, mais un service détaché peut continuer à tourner.

## Journal partagé

Les deux agents voient le même nom de connexion et disposent des outils correspondant à leur phase. Un partenaire consulté pour une relecture reste en lecture seule. Le récapitulatif distingue fichiers locaux, écritures SSH confirmées et commandes observées. Duo conserve les chemins, commandes, empreintes et statuts, sans recopier le contenu distant ou la sortie SSH dans ce journal. Les réponses des agents peuvent toutefois reprendre des extraits : relire les exports avant de les partager.

La clé choisie, son agent et les permissions OpenSSH continuent à fonctionner hors de Duo. Supprimer une connexion dans Duo efface seulement ses métadonnées locales.
