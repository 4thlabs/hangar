# Plan — Gestion des thèmes visuels

## Context

Le site utilise actuellement la palette Nord directement dans `src/app/styles.css`, avec des variantes claire et sombre. Un nouveau fichier `src/app/theme/theme-claude.css` a été ajouté, mais son contenu est du TypeScript (deux objets de variables CSS) et doit être converti en CSS. Le projet possède déjà une préférence `light | dark | system` lue depuis le cookie `theme`, sans interface ni application complète de cette préférence.

Objectif : proposer une sélection extensible de palettes (Claude et Nord dans un premier temps), distincte du mode clair/sombre/système, conserver les deux choix et les appliquer sans flash visuel au chargement. Claude sera la palette par défaut.

## Approach

- Représenter chaque palette par un identifiant stable et un libellé dans un registre partagé et extensible (`claude`, `nord` initialement), avec Claude comme valeur par défaut.
- Convertir les objets Claude en sélecteurs CSS `[data-theme="claude"]` / `.dark[data-theme="claude"]`, et sortir également Nord de `styles.css` vers des sélecteurs équivalents. Une future palette nécessitera seulement son fichier CSS, son import et son entrée de registre.
- Importer les feuilles de thème depuis la feuille globale Tailwind afin de conserver un seul point d’entrée CSS.
- Conserver le cookie `theme` pour le mode `light | dark | system` et ajouter un cookie distinct pour la palette. Étendre le parseur de préférences existant avec une validation par liste blanche et les valeurs par défaut `claude` + `system`.
- Ajouter une carte **Apparence** dans `/settings`, avec deux sélecteurs composés à partir des primitives Dropdown Menu déjà installées : palette et mode. Les options de palette seront générées depuis le registre pour accueillir les thèmes futurs.
- Remplacer le `className="dark"` forcé sur `<body>` par des attributs rendus côté serveur sur `<html>` à partir des cookies, sans injection de script.
- Centraliser l’état dans un `ThemeProvider` React global qui synchronise le DOM, les cookies et l’écoute des changements système via `prefers-color-scheme`.

## Files to modify

- `src/app/theme/theme-claude.css` — convertir les objets TypeScript en CSS valide.
- `src/app/theme/theme-nord.css` — déplacer/formaliser la palette Nord actuellement intégrée à la feuille globale.
- `src/app/styles.css` — importer les thèmes et conserver les tokens Tailwind/base communs.
- `src/libs/preferences/themes.ts` — nouveau registre partagé des palettes et modes disponibles, avec types, gardes de validation et valeurs par défaut.
- `src/libs/preferences/constants.ts` — ajouter le nom du cookie de palette et réutiliser le nom actuel pour le mode.
- `src/libs/preferences/server.ts` — parser et exposer la palette ainsi que le mode de couleur retenus.
- `src/libs/preferences/server.test.ts` — couvrir valeurs valides, valeurs invalides et défauts.
- `src/app/pages/_root.tsx` — lire les préférences serveur, les appliquer sur `<html>` et installer le provider global.
- `src/app/components/theme-provider.tsx` — Context global, persistance et synchronisation DOM/média.
- `src/app/components/theme-settings-card.tsx` — nouvelle Card cliente contenant les deux sélecteurs et consommant le Context.
- `src/app/pages/(app)/settings.tsx` — lire les préférences de la requête et intégrer la carte Apparence.

## Reuse

- `src/libs/preferences/server.ts` et `src/app/pages/_interceptors/user-preferences.ts` — infrastructure existante de préférences par cookie et contexte de requête.
- `src/libs/preferences/constants.ts` — contient déjà `THEME_COOKIE_NAME`, qui restera le cookie du mode afin de ne pas invalider les préférences existantes.
- `src/app/styles.css` — tokens sémantiques shadcn/Tailwind v4 (`--background`, `--primary`, `--sidebar-*`, etc.).
- `src/app/pages/(app)/settings.tsx` et `src/app/components/store-settings-card.tsx` — structure actuelle de la page et composition `Card`/`Field`.
- `src/app/components/ui/dropdown-menu.tsx` — `DropdownMenuRadioGroup` et `DropdownMenuRadioItem` déjà disponibles pour les sélecteurs, sans nouvelle dépendance.
- `src/app/components/ui/button.tsx` — déclencheurs des deux menus.
- `window.matchMedia`, déjà employé dans `src/app/hooks/use-mobile.ts` — même modèle d’abonnement navigateur pour le mode système.

## Steps

- [x] Examiner les palettes ajoutées, les styles globaux et le mécanisme de préférences existant.
- [x] Confirmer deux réglages distincts (palette extensible + mode clair/sombre/système), Claude par défaut et une carte Apparence dans Paramètres.
- [x] Créer le registre typé des palettes/modes et définir des sélecteurs CSS cohérents pour Nord et Claude, en complétant/normalisant toutes les variables sémantiques requises (dont `--destructive-foreground` absent des objets Claude).
- [x] Étendre le parsing/persistance des préférences et leurs tests, en conservant la compatibilité du cookie de mode existant.
- [x] Rendre les attributs initiaux sur `<html>` côté serveur, avec validation des cookies et repli Claude/système, sans script injecté.
- [x] Créer le `ThemeProvider` et `ThemeSettingsCard`, appliquer les changements sans rechargement, persister les cookies et suivre les changements du système uniquement lorsque ce mode est actif.
- [x] Ajouter la carte Apparence à la page Paramètres à partir des préférences de la requête.
- [x] Vérifier les thèmes, la persistance, l’absence de flash et les états système.

## Verification

- Tester manuellement les 6 combinaisons Claude/Nord × clair/sombre/système sur les pages applicatives et d’authentification.
- Recharger la page et naviguer entre routes pour confirmer la persistance et l’absence de flash du mauvais thème.
- Modifier `prefers-color-scheme` avec le mode système et vérifier la mise à jour immédiate.
- Vérifier les composants principaux (sidebar, cards, menus, formulaires, états destructifs et graphiques) dans toutes les variantes.
- Exécuter les tests de préférences, les diagnostics TypeScript, `npm test` et `npm run build`.
