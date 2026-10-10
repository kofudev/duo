# Mesurer le gain

Duo vise un résultat relu avec moins de coordination inutile. Deux agents ne consomment pas automatiquement moins qu’un seul : ils lisent du contexte, écrivent et se relisent. Pour une modification simple, ce surcoût peut dépasser le bénéfice de la relecture.

## Ce que le mode économe change

La construction utilise un plan, puis un écrivain et une relecture partenaire par tâche. Le bilan final assemble localement les rapports et les observations : aucun nouvel appel IA pour reformuler ce qui est déjà disponible. Une mission de deux tâches sans consultation ni correction passe donc de six à cinq appels. Cela représente un appel supprimé, pas une réduction garantie de 16,7 % des tokens.

Après le plan, les étapes reçoivent l’objectif, les clarifications, la mémoire sélectionnée et les critères utiles. L’historique général et les longs rapports ne sont plus recopiés plusieurs fois. Les transmissions gardent le début et la fin des rapports, notamment les limites de validation. Les rapports complets restent visibles. Les snapshots des fichiers, les relectures, les modèles sélectionnés et leurs efforts sont conservés.

Une consultation reste disponible pour résoudre une incertitude technique. Une simple confirmation du fichier déjà écrit appartient normalement à la relecture obligatoire. Le mode complet conserve ses analyses et sa synthèse IA pour les demandes qui bénéficient d’une discussion plus large.

## Lire les compteurs

Dans la mission, ouvrir **Consommation mesurée**. Chaque appel indique la phase, les tokens d’entrée et de sortie, le cache lu et écrit quand le CLI les fournit. Les tokens bruts incluent le cache. Les appels interrompus peuvent avoir une consommation partielle ; une donnée absente reste inconnue et sa réservation est conservée. Les reprises gardent les compteurs. Les mesures par appel sont bornées à 200 entrées.

Le taux de cache représente les entrées réutilisées parmi les appels dont le cache est connu. Ce n’est ni une remise sur abonnement, ni une économie en euros. Les consommations des deux fournisseurs ne constituent pas un quota commun. OpenAI précise que taille du contexte, complexité et durée influencent les limites ; Claude distingue les compteurs de tokens du suivi de l’abonnement. [Documentation OpenAI](https://learn.chatgpt.com/docs/pricing), [documentation Claude Code](https://code.claude.com/docs/en/costs).

## Ce qui est démontré

Les tests locaux vérifient les cinq appels, les deux relectures, les fichiers effectivement produits, les informations de validation conservées et l’absence d’appel de bilan. Le chantier réel enregistré pour 0.5.0 a consommé environ 263 000 tokens connus, cache inclus, avant pause à la réserve quota. Deux fichiers ont été créés et leur résultat vérifié ; la dernière relecture n’a pas terminé.

Aucun comparatif réel contrôlé ne démontre encore une économie globale face à un agent seul, ni le gain de tokens de 0.5.1 par rapport à 0.5.0. Pour le mesurer : mêmes sources initiales, même objectif, mêmes modèles et efforts, mêmes critères de validation ; relever appels, tokens, cache, durée, corrections et résultat effectivement testé. Refaire plusieurs tâches et conserver les échecs. Un résultat plus court ou non vérifié ne suffit pas à prouver un gain.
