# Plan — Catégoriser la navigation et gérer le store

## Context

La sidebar ne contient actuellement qu’un groupe « Navigation » et un lien Dashboard, déclarés directement dans `src/app/components/app-sidebar.tsx`. Le store est configuré par `config.store` et ne peut être installé que via la commande CLI `hangar store install`. L’objectif est de structurer la navigation depuis un fichier dédié et d’ajouter une page de paramètres permettant de voir le dépôt configuré et de l’installer ou le mettre à jour.

## Approach

- Extraire la définition typée des groupes et liens de navigation dans `src/app/navigations.ts`, avec deux groupes initiaux : « Général » (Dashboard) et « Administration » (Paramètres). La sidebar rendra ces groupes dynamiquement en conservant l’état actif et la fermeture du panneau mobile.
- Ajouter une route applicative `/settings`, protégée par le layout `(app)` existant.
- Afficher l’URL `config.store` en lecture seule et proposer un bouton contextuel unique : « Installer » si le dépôt local est absent, « Mettre à jour » s’il existe.
- Réutiliser et faire évoluer la couche `src/libs/store` afin que le bouton appelle la bonne opération serveur : `git clone` lors de l’installation, `git pull --ff-only` sur la branche courante lors de la mise à jour. Après chaque opération Git réussie, réconcilier les liens des stacks configurées.
- Lire l’état initial côté serveur, puis exposer une Server Action Waku qui revérifie la session et l’état réel du dépôt au moment du clic avant de sélectionner `install()` ou `update()` ; le navigateur ne transmettra ni URL, ni chemin, ni commande.
- Présenter l’action et son résultat avec une Card complète et les composants Button, Alert et Spinner existants. Un petit composant client gérera uniquement l’état pending/succès/erreur et actualisera son libellé après une installation réussie.

## Files to modify

- `src/app/navigations.ts` — nouveau modèle centralisé des catégories et liens de navigation.
- `src/app/components/app-sidebar.tsx` — consommer les catégories au lieu du tableau local.
- `src/app/pages/(app)/settings.tsx` — nouvelle page serveur Paramètres, lecture de la configuration/état et Server Action authentifiée.
- `src/app/components/store-settings-card.tsx` — nouvelle Card cliente avec URL en lecture seule, bouton contextuel et retours d’opération.
- `src/libs/store/management.ts` — compléter la gestion du store avec état, installation, mise à jour et réconciliation des liens.
- `src/libs/store/management.test.ts` — tests ciblés des branches installation/mise à jour et des codes d’échec.
- `src/libs/store/index.ts` — continuer à exposer les opérations de gestion nécessaires à la page.
- `src/app/pages.gen.ts` — régénérer les types de routes Waku.

## Reuse

- `src/app/components/ui/sidebar.tsx` — `SidebarGroup`, `SidebarGroupLabel`, `SidebarMenu` et état responsive existants.
- `src/libs/store/config.ts` — `config.store`, source actuelle de l’URL du dépôt.
- `src/libs/store/management.ts` — fonction `install()` existante, basée sur `HANGAR_DATA_DIR`, `exists()` et `run()`.
- `src/libs/runtime` — helpers `exists()`, `resolve()` et `run()` existants pour l’état local, la liste dédupliquée des stacks et Git sans shell intermédiaire.
- `src/libs/auth/session.ts` — `requireSession()`, à rappeler dans la Server Action car les actions Waku constituent leurs propres endpoints et ne sont pas sécurisées par le seul layout.
- Server Actions Waku et React `useTransition` — appel serveur direct depuis le bouton avec état pending, sans route API manuelle ; `router.reload()` reste disponible si un rafraîchissement serveur est nécessaire.
- `src/app/components/ui/{card,field,input,button,alert,spinner}.tsx` — primitives déjà installées pour la Card complète, l’URL en lecture seule et les retours d’action.
- `src/app/pages/(app)/_layout.tsx` — layout authentifié existant qui couvrira `/settings`.

## Steps

- [x] Valider les catégories initiales (« Général » et « Administration »), l’URL en lecture seule et le bouton contextuel d’installation/mise à jour.
- [ ] Définir les catégories et entrées dans `src/app/navigations.ts`, avec les icônes Lucide et les chemins typés adaptés à Waku.
- [ ] Adapter `AppSidebarContent` pour parcourir chaque catégorie et ses liens, en préservant l’état actif, les tooltips du mode replié et la fermeture mobile existante.
- [ ] Normaliser la couche de gestion du store autour de chemins centralisés et de codes de sortie déterministes : détecter le clone, créer les répertoires requis, terminer l’installation initiale après le clone, puis créer les liens manquants.
- [ ] Ajouter `update()` avec `git -C <store> pull --ff-only`, sans écraser les modifications/divergences locales, puis réconcilier les liens comme lors de l’installation.
- [ ] Créer la Server Action dans `/settings` : appeler `requireSession()`, revérifier si le clone existe, sélectionner l’opération de bibliothèque correspondante et retourner un résultat sérialisable et lisible.
- [ ] Créer la page et `StoreSettingsCard` : titre, URL `config.store` dans un champ read-only, état installé/non installé, bouton « Installer »/« Mettre à jour », désactivation pendant l’appel et Alert de succès/échec.
- [ ] Ajouter les tests de gestion du store, régénérer les routes et couvrir les états en cours, succès et erreur.

## Verification

- Vérifier les catégories, les liens actifs, le mode sidebar replié et la fermeture mobile sur `/` et `/settings`.
- Vérifier que `/settings` affiche exactement l’URL issue de la configuration serveur.
- Sur un répertoire de données isolé : vérifier que le premier clic clone puis crée les liens configurés, que le libellé devient « Mettre à jour », puis qu’un second clic récupère un nouveau commit via un fast-forward et conserve/réconcilie les liens.
- Vérifier qu’un échec de clone/pull laisse un état cohérent, réactive le bouton et affiche une erreur sans exposer de détails sensibles ; vérifier aussi qu’une divergence Git n’est pas écrasée.
- Vérifier qu’un utilisateur non authentifié est redirigé par le layout et ne peut pas invoquer directement la Server Action.
- Exécuter `npm run typegen`, les diagnostics TypeScript sur les fichiers touchés, `npm test` et `npm run build`.
