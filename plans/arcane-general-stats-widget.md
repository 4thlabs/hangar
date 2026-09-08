# Plan — Widget React Arcane : statistiques générales

## Context

Remplacer progressivement les widgets Arcane du dashboard Glance par des composants React intégrés à Hangar. Ce premier lot porte uniquement sur la vue générale correspondant à `../homelab/store/glance/config/widgets/arcane/dashboard.yml`, à afficher sur la page dashboard `/`. Tous les libellés de l’interface resteront en anglais.

Le widget Glance source lit `GET /api/environments/${ARCANE_ENV_ID}/dashboard` avec `X-API-Key` et présente : version/mise à jour, nombre total de conteneurs, états running/stopped, images (total, inutilisées, taille), volumes (total, utilisés/inutilisés) et éventuels éléments d’action.

## Approach

- Étendre le client Arcane serveur existant pour typer et récupérer la réponse agrégée `/environments/{id}/dashboard`.
- Ajouter la carte en deux couches dans le même module : une vue pure recevant les données typées et un composant serveur asynchrone chargé de l’appel Arcane et de l’isolation des erreurs.
- Limiter le modèle aux champs réellement lus : `versionInfo`, `containers.counts`, `imageUsageCounts`, `volumeUsageCounts` et `actionItems.items` (`severity`, `count`, `kind`).
- Composer l’interface avec la `Card` shadcn existante et les couleurs sémantiques du thème Hangar : en-tête avec lien Arcane/version, puis métriques running, stopped, images et volumes, suivies des actions lorsqu’elles existent. Reprendre le format Glance pour la taille totale des images (Go/GB à une décimale), afficher les détails secondaires sans dépendre du survol et ouvrir les liens Arcane/release dans un nouvel onglet.
- Rendre le widget autonome en largeur (`w-full`, aucune dimension fixe) et utiliser une grille interne pilotée par container queries, afin qu’il s’adapte à la largeur de sa future colonne plutôt qu’à celle du viewport. Ce lot n’ajoute ni glisser-déposer ni persistance de disposition.
- Placer les widgets de `/` dans une grille responsive simple dont l’ordre restera défini dans le JSX et pourra évoluer lors de l’ajout des prochaines cartes.
- Charger les données une seule fois côté serveur à chaque chargement/navigation, sans polling, état client ou exposition de la clé API au navigateur.
- Entourer le widget asynchrone d’un `Suspense` avec une carte `Skeleton` de mêmes proportions pour le chargement initial.
- Intercepter au niveau du widget les erreurs réseau ainsi que les réponses Arcane `success: false` : journaliser le détail uniquement côté serveur, conserver le dashboard et afficher dans la carte un `Alert` destructif générique en anglais.

## Files to modify

- `src/libs/api/arcane/type.ts` — types minimaux de la réponse dashboard Arcane consommée par la vue.
- `src/libs/api/arcane/client.ts` — fonction `getDashboard(environment = 0)` et URL Arcane réutilisable, sur le client `ky` existant.
- `src/libs/widgets/arcane/general-stats.tsx` — vue typée, wrapper serveur, état d’erreur et skeleton responsives (répertoire actuellement vide et non suivi).
- `src/libs/widgets/arcane/general-stats.test.tsx` — rendu statique des variantes principales avec Vitest et `react-dom/server`, sans nouvelle dépendance.
- `src/libs/widgets/arcane/index.ts` et `src/libs/widgets/index.ts` — exports publics du widget.
- `src/app/pages/(app)/index.tsx` — titre, grille responsive et insertion du widget sous `Suspense` sur `/`.
- `.env.example` — documenter `DOMAIN` et `ARCANE_API_KEY`, déjà consommées par le client ; ne pas les rendre globalement obligatoires dans `src/libs/env/env.ts`, afin qu’une configuration Arcane absente aboutisse à l’état d’erreur isolé plutôt qu’à l’arrêt de Hangar.

## Reuse

- `src/libs/api/arcane/client.ts` — client `ky` serveur déjà configuré avec `https://arcane.${DOMAIN}/api`, `X-API-Key` et l’environnement local `0` par défaut.
- `src/libs/api/arcane/type.ts` — enveloppe générique `ArcaneResult<T>` existante.
- `src/app/pages/(app)/index.tsx` — page déjà dynamique et protégée par le layout applicatif ; aucune nouvelle route API n’est nécessaire.
- `src/app/components/ui/card.tsx` — composition shadcn `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` et `CardFooter`.
- `src/app/components/ui/alert.tsx` — état d’erreur accessible déjà disponible.
- `src/app/components/ui/skeleton.tsx` — placeholders shadcn déjà disponibles pour le chargement initial.
- `lucide-react` — icônes déjà utilisées par l’application ; aucune nouvelle ressource distante pour le logo.
- `src/app/styles.css` — tokens Nord et couleurs sémantiques clair/sombre déjà définis.
- `../homelab/store/glance/config/widgets/arcane/dashboard.yml` — référence fonctionnelle et inventaire exact des métriques.

## Steps

- [x] Identifier le widget Glance de référence et les métriques affichées.
- [x] Identifier le point d’intégration React, le client Arcane et les primitives UI réutilisables.
- [x] Confirmer l’emplacement `/`, une présentation responsive et un état d’erreur isolé.
- [x] Limiter la réorganisation à une carte adaptable dans une grille, sans interaction de glisser-déposer.
- [x] Valider un chargement serveur unique, sans rafraîchissement automatique, et des libellés toujours en anglais.
- [x] Définir les types minimaux à partir des chemins vérifiés par le widget Glance ; l’instance Arcane locale n’est pas joignable avec le `.env` de développement actuel (`DOMAIN` absent), donc confirmer les valeurs contre l’API réelle lors de la vérification manuelle.
- [x] Ajouter `getDashboard(environment = 0)` au client serveur et conserver le contrat `ArcaneResult<T>` existant.
- [x] Construire la carte responsive avec container queries, détails secondaires visibles, actions conditionnelles, skeleton et erreur isolée.
- [x] Documenter les deux variables Arcane nécessaires dans `.env.example`.
- [x] Remplacer le placeholder de `/` par le titre et la grille de widgets, puis insérer la carte sous `Suspense`.
- [x] Ajouter des tests de rendu statique couvrant les données normales, la mise à jour disponible, les actions et l’état d’erreur.

## Verification

- Exécuter les diagnostics TypeScript/LSP sur tous les fichiers TypeScript/TSX modifiés.
- Exécuter `npm test`, puis `npm run build`.
- Lancer Hangar avec `DOMAIN` et `ARCANE_API_KEY`, ouvrir `/` et comparer chaque nombre/version avec la réponse réelle d’Arcane et le widget Glance.
- Redimensionner la colonne/carte (mobile, largeur intermédiaire, desktop) pour vérifier que la grille interne réagit à son conteneur sans débordement ; contrôler aussi les thèmes clair et sombre.
- Vérifier les variantes : mise à jour disponible/absente, stopped égal/supérieur à zéro, actions vides/non vides, informations secondaires images/volumes et liens externes.
- Démarrer sans configuration Arcane ou simuler une API indisponible : le skeleton doit laisser place à l’alerte anglaise tandis que le reste du dashboard et sa navigation restent utilisables.
