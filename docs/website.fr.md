# Installer le site sur duo.varelia.fr

Site statique : HTML, CSS, JavaScript, images et polices locales. Aucun serveur Node.js ni base de données requis.

1. Télécharger `Duo-0.4.1-site.zip` depuis les Releases GitHub.
2. Extraire l'archive. `index.html` se trouve directement à la racine.
3. Associer `duo.varelia.fr` au dossier web voulu dans votre hébergement. Déposer **tout le contenu extrait** dans ce dossier, en conservant `assets/`.
4. Activer HTTPS, ouvrir `https://duo.varelia.fr` et tester un téléchargement.

Le dépôt n'a pas modifié votre DNS ou votre hébergement. La configuration du sous-domaine reste à faire dans votre espace hébergeur si elle n'existe pas encore. Les fichiers Windows sont téléchargés depuis GitHub Releases.

Le site n'utilise ni cookies ni mesure d'audience. Votre hébergeur peut conserver ses propres journaux d'accès. Le navigateur ne contacte GitHub qu'après un clic vers un téléchargement ou le dépôt.

## Depuis les sources

```powershell
npm run site:preview
npm run test:site
python scripts/package-site.py
```

L'archive utilise Python 3, exclut les fichiers de développement et vérifie son intégrité. Le ZIP est créé dans `release/`.

## Mettre à jour

Modifier la version et les liens dans `website/release.json`, puis les liens de secours et la version dans `website/index.html`. Les liens fonctionnent sans JavaScript. Ne publiez pas un lien avant ses fichiers GitHub. Les empreintes finales sont attachées à la release dans `SHA256SUMS.txt`.

Le nom canonique, le sitemap et les métadonnées de partage utilisent `https://duo.varelia.fr`. Un autre domaine nécessite leur mise à jour. Le site vise la racine du sous-domaine ; un sous-dossier demande d'adapter les liens commençant par `/`.
