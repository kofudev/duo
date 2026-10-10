# Héberger le site Duo

Le site est statique : aucun serveur Node.js ni base de données. Les installateurs sont servis par GitHub Releases. Le bouton Télécharger mène directement au fichier `.exe`, y compris sans JavaScript.

## Déploiement automatique sur VPS

`Deploy website` se lance quand les fichiers du site changent sur `main`, après une publication Windows, ou à la demande depuis Actions. Il vérifie le site, récupère le manifeste de la dernière version publique puis déploie une archive. Les fichiers de développement ne sont pas envoyés.

Configuration GitHub, dans l'environnement **production** :

| Type     | Nom                   | Contenu                                            |
| -------- | --------------------- | -------------------------------------------------- |
| Secret   | `DUO_SSH_KEY`         | Clé privée dédiée au déploiement Duo               |
| Secret   | `DUO_SSH_KNOWN_HOSTS` | Clé publique SSH du VPS, vérifiée hors du workflow |
| Variable | `DUO_SSH_HOST`        | Adresse du VPS                                     |
| Variable | `DUO_SSH_USER`        | `duo-deploy`                                       |
| Variable | `DUO_SSH_PORT`        | `22`, ou le port SSH configuré                     |

La clé est limitée à `/usr/local/lib/duo/site-receiver.py`, avec commande `deploy`. Pas de shell interactif ni de transfert de ports. Le compte déploie uniquement dans `/var/www/duo`. Il ne modifie pas les autres sites.

## Installer sur un autre VPS Debian/nginx

1. Créer une clé SSH dédiée. Garder la partie privée dans les secrets GitHub, jamais dans le dépôt.
2. Via votre accès administrateur existant, copier `deploy/site-receiver.py` vers `/tmp/duo-site-receiver.py`, `deploy/nginx.conf` vers `/tmp/duo-nginx.conf` et la clé **publique** vers `/tmp/duo-deploy.pub`.
3. Lire puis exécuter `deploy/setup.sh` en root sur le VPS. Il refuse un site ou compte Duo déjà existant. Adapter le domaine dans la configuration pour un autre hébergement.
4. Configurer les secrets et variables ci-dessus. Épingler la véritable clé SSH du serveur, sans accepter aveuglément une clé obtenue sur le réseau.
5. Publier une version Windows puis lancer Deploy website. Les fichiers sont dans `releases/<date>` et `current` pointe vers la version active.
6. Activer HTTPS avec votre certificat. Pour Let's Encrypt : `certbot certonly --webroot -w /var/www/duo/acme -d duo.varelia.fr`. Ajouter ensuite le serveur nginx TLS avec ce certificat, vérifier `nginx -t` avant de recharger. Garder le contrôle de santé local HTTP fonctionnel.

Le récepteur refuse chemins sortants, liens symboliques, fichiers cachés et contenus exécutables serveur. Après bascule, il vérifie le manifeste servi par nginx. En cas d'échec, il restaure la version précédente. Les cinq derniers déploiements restent disponibles.

## Dépôt de fichiers manuel

Télécharger l'archive `Duo-<version>-site.zip`, extraire son contenu dans le dossier du sous-domaine et activer HTTPS. `index.html` se trouve directement à la racine. Conserver `assets/` et tous les fichiers.

Pour prévisualiser et vérifier localement :

```powershell
npm run site:preview
npm run test:site
python scripts/package-site.py
```

Le site n'utilise ni cookies ni mesure d'audience. L'hébergeur conserve éventuellement ses propres journaux d'accès. Le navigateur ne contacte GitHub qu'après un clic de téléchargement ou vers le dépôt. Domaine canonique : `https://duo.varelia.fr`.
