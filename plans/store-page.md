# Page Store

## Context

Construire la première version de la page Store à partir de `hangar.store.apps` : une grille simple d’applications, sans recherche ni filtrage pour l’instant. Chaque carte doit afficher l’icône, le nom, l’état de l’application et une action d’installation ou un indicateur si elle est déjà installée.

## Approach

- Rendre `StorePage` asynchrone et lire directement `[...hangar.store.apps]` côté serveur ; la page est déjà configurée en rendu dynamique et son layout protège la route avec `requireSession()`.
- Afficher une grille responsive de petites cartes shadcn. Chaque entrée contient déjà `{ id, name, icon, installed }`, construite depuis le `compose.yml` du store par `HangarStore.refresh()`.
- Utiliser l’URL `icon` fournie par le store dans une image décorative/accessible, le nom comme titre, puis soit un petit bouton `Installer`, soit une icône Lucide avec libellé accessible lorsque `installed` vaut `true`.
- Garder cette première version sans recherche ni filtrage et sans ajouter de dépendance/composant shadcn.

## Files to modify

- `src/app/pages/(app)/store.tsx` — chargement des données, état vide et grille de cartes.
- `src/app/actions/install-app.ts` — server action authentifiée qui valide l’identifiant contre `hangar.store.apps`, appelle `hangar.store.link(id)`, rafraîchit le store et retourne un résultat explicite.
- `src/app/components/store/store-app-card.tsx` — composant client minimal pour gérer le clic, l’état pending, la confirmation locale et les erreurs via le toast existant.

## Reuse

- `src/libs/hangar/hangar-store.ts` — `apps: Set<HangarApp>` est peuplé par `refresh()` depuis les dossiers du store ; `link(name)` sait déjà créer le lien d’installation et ignore une destination existante.
- `src/app/pages/(app)/settings.tsx` — modèle de page serveur dynamique lisant `hangar`.
- `src/app/actions/manage-store.ts` — modèle d’action authentifiée avec résultat typé et gestion d’erreur.
- `src/app/components/settings/store-settings-card.tsx` — modèle client `useTransition`, spinner et toast pour une action serveur.
- `src/app/components/ui/card.tsx` et `button.tsx` — composants déjà installés ; aucune installation shadcn nécessaire.
- `lucide-react` — bibliothèque d’icônes configurée dans `components.json`.

## Steps

- [x] Confirmer la forme de `hangar.store.apps` et la source de vérité de l’état installé.
- [x] Confirmer que `Installer` doit être fonctionnel dans cette première itération.
- [x] Ajouter une action serveur protégée par `requireSession()`, refuser tout identifiant absent du catalogue et journaliser proprement les échecs.
- [x] Implémenter le chargement serveur, l’état vide et la grille responsive.
- [x] Composer chaque carte avec l’icône distante, le nom, le bouton d’installation ou l’indicateur installé accessible.
- [x] Gérer l’installation avec `useTransition`, désactiver le bouton et afficher le spinner pendant l’action, puis remplacer le bouton par l’indicateur en cas de succès et afficher un toast en cas d’échec.

## Verification

- Lancer les diagnostics TypeScript/LSP sur les fichiers modifiés.
- Exécuter les tests pertinents et le build du projet.
- Vérifier manuellement la page Store sur desktop et mobile, avec une application installée et une non installée, ainsi que le catalogue vide.
- Vérifier qu’un clic sur Installer crée le lien dans `app-installed`, empêche les doubles clics, remplace le bouton par l’indicateur installé et affiche correctement une erreur en cas d’échec.
- Vérifier qu’un identifiant inconnu envoyé directement à l’action est refusé.
