# Plan — Mutualiser les composants des widgets

## Context

Les trois widgets actuels de `src/libs/widgets` répètent des structures et classes Tailwind similaires : cadre de carte, largeur, en-tête avec titre/icône/lien, métadonnées séparées par des points, contenu, métriques, listes, état vide, footer, chargement et erreur. L’objectif est d’en faire un petit vocabulaire visuel commun, réutilisable par les prochains widgets, sans modifier les données affichées ni le comportement métier.

## Approach

- Créer dans `shared` des primitives sémantiques qui portent les styles communs : `WidgetCard`, en-tête/titre de service avec lien externe optionnel, métadonnées, contenu, grille de métriques et métrique avec variante destructive, liste/ligne de liste, état vide et footer titré.
- Garder ces primitives composables (`children`/`ReactNode`) afin que les modules de service conservent leur balisage métier, leurs URLs, leurs formateurs et leurs règles de couleur.
- Faire reposer `WidgetSkeleton` et `WidgetError` sur le même cadre et le même en-tête plutôt que de dupliquer directement les composants `Card*` et leurs classes.
- Refactoriser Arcane et Frigate sur l’ensemble de ce vocabulaire partagé ; refactoriser Clock sur le cadre et le contenu communs, sans forcer ses deux colonnes date/heure dans une abstraction artificielle.
- Préserver les hauteurs propres à chaque widget (`h-20`, `min-h-64`, `min-h-88`) via `className`, tandis que `w-full` devient une responsabilité du cadre commun.
- Conserver les exports publics actuels (`*Card`, `*Skeleton`, `*Widget`) et le rendu visuel/accessible existant.

## Files to modify

- `src/libs/widgets/shared/widget.tsx` — nouvelles primitives de composition et styles partagés.
- `src/libs/widgets/shared/widget.test.tsx` — contrat de rendu des primitives (structure, lien externe, métadonnées, variantes et classes communes).
- `src/libs/widgets/shared/widget-error.tsx` — composition avec les nouvelles primitives.
- `src/libs/widgets/shared/widget-skeleton.tsx` — composition avec les nouvelles primitives.
- `src/libs/widgets/shared/index.ts` — exports du nouveau vocabulaire commun.
- `src/libs/widgets/arcane/general-stats.tsx` — remplacement de la carte, de l’en-tête, des métriques et du footer locaux.
- `src/libs/widgets/frigate/events.tsx` — remplacement de la carte, de l’en-tête, des métadonnées, de la liste et de l’état vide.
- `src/libs/widgets/clock/clock.tsx` — remplacement du cadre et du contenu de carte.
- Tests existants sous `src/libs/widgets/**` — adaptation des assertions si la structure interne évolue, tout en conservant les assertions fonctionnelles.

## Reuse

- `src/libs/widgets/shared/widget-error.tsx` — état d’erreur commun existant, déjà fondé sur une carte et un en-tête.
- `src/libs/widgets/shared/widget-skeleton.tsx` — squelette commun existant, paramétré par icône, titre, sous-titre et footer.
- `src/app/components/card/accent-card.tsx` — carte accentuée déjà utilisée par les quatre rendus étudiés.
- `src/app/components/ui/card.tsx`, `alert.tsx`, `skeleton.tsx` — primitives shadcn existantes ; leurs espacements et slots restent la base de la composition.
- `cn` via `#libs/utils` — fusion des classes et variantes conditionnelles.

## Steps

- [x] Cartographier les duplications de structure et de classes entre Arcane, Frigate, Clock, `WidgetSkeleton` et `WidgetError`.
- [x] Ajouter les primitives partagées de carte, en-tête/lien, métadonnées, contenu, métriques, liste/ligne, état vide et footer, avec `className` fusionné par `cn` lorsque nécessaire.
- [x] Recomposer `WidgetSkeleton` et `WidgetError` avec ces primitives en conservant `aria-busy`, le rôle d’alerte et leurs options actuelles.
- [x] Refactoriser Arcane, Frigate et Clock ; supprimer leurs imports directs de `Card*` devenus inutiles et les chaînes de classes désormais centralisées.
- [x] Exporter les primitives depuis `shared/index.ts` sans casser les exports publics de `src/libs/widgets/index.ts`.
- [x] Ajouter les tests unitaires des primitives et maintenir les tests de rendu propres à chaque service.

## Verification

- Exécuter `npm test -- src/libs/widgets` puis `npm test`.
- Exécuter les diagnostics TypeScript/LSP sur tous les fichiers modifiés, puis `npm run build`.
- Vérifier dans le HTML de test : liens externes sûrs, titres/icônes, séparateurs de métadonnées, sémantique `dl/dt/dd` des métriques, `ul/li` des listes, variante destructive, footer, `aria-busy` et alerte.
- Comparer manuellement sur le dashboard les états normal, vide, chargement et erreur, les trois hauteurs, ainsi que les dispositions responsive Arcane/Frigate ; aucun changement visuel intentionnel.
