# Plan — Ajouter une barre latérale

## Context

Ajouter une navigation latérale aux pages applicatives, tout en conservant les pages d’authentification `/login` et `/register` sans sidebar.

## Approach

- Conserver `src/app/pages/_layout.tsx` comme layout racine commun, limité aux styles, métadonnées et polices.
- Créer un groupe de routes applicatif `(app)` doté de son propre `_layout.tsx`, puis y déplacer les pages `/` et `/about` sans modifier leurs URLs. Waku applique ainsi la sidebar uniquement à ce groupe, tandis que `(auth)` garde `/login` et `/register` hors de ce layout.
- Composer le layout avec les primitives shadcn/Base UI déjà installées (`SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, menus), avec une sidebar desktop rétractable et le panneau mobile natif.
- Créer un composant client de sidebar applicatif contenant l’identité Hangar, les liens Dashboard et À propos, leur état actif basé sur `useRouter().path`, puis un espace utilisateur dans `SidebarFooter > SidebarMenu`.
- Résoudre la session côté serveur avec un helper dédié appelant `auth.api.getSession({ headers: unstable_getRequest().headers })`. Le layout `(app)` sera dynamique, appellera ce helper et transmettra uniquement les données utilisateur nécessaires à la sidebar cliente.
- Dans `SidebarFooter > SidebarMenu`, afficher le nom et l’e-mail reçus du serveur, proposer une déconnexion via `authClient.signOut()` suivie d’une redirection vers `/login`, et afficher un accès à la connexion lorsqu’aucune session n’existe. Aucune récupération initiale de session ne sera faite côté client et aucune garde d’accès aux routes ne sera ajoutée hors périmètre.

## Files to modify

- `src/app/pages/_layout.tsx` — retirer le conteneur de page centré, mais conserver les responsabilités globales.
- `src/app/pages/(app)/_layout.tsx` — nouveau layout applicatif avec provider, sidebar, déclencheur mobile et zone de contenu.
- `src/app/pages/(app)/index.tsx` — déplacement de `src/app/pages/index.tsx` (URL `/` inchangée).
- `src/app/pages/(app)/about.tsx` — déplacement de `src/app/pages/about.tsx` (URL `/about` inchangée).
- `src/app/components/app-sidebar.tsx` — nouvelle composition client de navigation et de l’espace utilisateur, alimentée par les données de session du layout serveur.
- `src/libs/auth/session.ts` — nouveau helper exclusivement serveur pour lire la session Better Auth à partir des en-têtes de la requête Waku.
- `src/libs/auth/index.ts` — exporter le helper serveur avec la configuration d’authentification existante.
- `src/app/pages.gen.ts` — régénéré par Waku après le déplacement des routes.

## Reuse

- `src/app/components/ui/sidebar.tsx` — primitive shadcn/Base UI déjà installée, incluant le provider, le mode mobile via `Sheet`, le raccourci clavier et les composants de menu.
- `src/app/hooks/use-mobile.ts` — hook responsive déjà consommé par la primitive Sidebar.
- `src/app/pages/(auth)/_layout.tsx` — layout dédié à `/login` et `/register`, à conserver sans sidebar.
- `Link` et `useRouter` de `waku` — navigation interne et détection de la route active ; `useRouter` est déjà employé par le formulaire de connexion.
- `auth` dans `src/libs/auth/auth.ts` — instance Better Auth 1.7.3 existante ; son API serveur `auth.api.getSession()` sera encapsulée par le nouveau helper.
- `unstable_getRequest` de `waku/router/server` — API serveur de Waku 1.0.0-rc.0 donnant accès aux en-têtes/cookies de la requête courante.
- `authClient` dans `src/libs/auth/client/auth.ts` — client existant utilisé uniquement pour l’action de déconnexion.
- Variables `--sidebar-*` dans `src/app/styles.css` — thème clair/sombre déjà prêt pour la sidebar.

## Steps

- [x] Identifier la hiérarchie des layouts, les routes et les primitives UI existantes.
- [x] Valider le contenu : Hangar, Dashboard, À propos et espace utilisateur dans `SidebarFooter > SidebarMenu`.
- [ ] Alléger le layout racine, déplacer les pages applicatives dans `(app)` sans changer leurs URLs et créer son layout dédié.
- [ ] Ajouter le helper serveur de session, rendre le layout `(app)` dynamique et lui faire transmettre l’utilisateur résolu à `AppSidebar`.
- [ ] Composer `AppSidebar` avec les liens actifs et les états utilisateur (connecté, déconnecté, déconnexion en cours), sans `useSession()` côté client.
- [ ] Intégrer `SidebarProvider`, `SidebarInset` et un `SidebarTrigger` accessible pour le panneau mobile et le repli desktop.
- [ ] Régénérer les types de routes Waku, puis vérifier l’accessibilité et le responsive.

## Verification

- Vérifier manuellement la présence de la sidebar sur `/` et `/about`, ainsi que l’état actif de chaque lien.
- Vérifier son absence complète sur `/login` et `/register`.
- Vérifier le panneau mobile, le déclencheur, le repli desktop et la navigation au clavier.
- Vérifier côté serveur que les cookies de la requête sont transmis à Better Auth et que le footer reçoit le nom/e-mail connecté ; vérifier aussi l’accès à la connexion sans session et la déconnexion suivie de la redirection vers `/login`.
- Exécuter `npm run typegen`, les diagnostics TypeScript, `npm test` et `npm run build`.
