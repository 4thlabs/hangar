# Plan — Remplacer la sidebar par une barre de navigation supérieure

## Context

Le layout applicatif utilise actuellement `SidebarProvider`, `AppSidebar`, `SidebarInset` et `SidebarTrigger`. L’objectif est de conserver tout le code de sidebar pour un éventuel retour, mais de ne plus le monter dans le layout. Les pages authentifiées utiliseront une navbar horizontale avec la marque Hangar, un accès Dashboard, une recherche centrée, un accès Paramètres et le menu utilisateur actuel.

## Approach

- Créer une navbar cliente dédiée, alimentée par l’utilisateur déjà résolu côté serveur dans le layout applicatif.
- Composer la barre avec les primitives shadcn/Base UI existantes : `Button`, `InputGroup`, `Avatar`, `DropdownMenu`, `Tooltip` et `Separator` si nécessaire.
- Réutiliser le comportement du menu utilisateur actuel (avatar, nom, e-mail, état de déconnexion et redirection), tout en l’adaptant à une disposition horizontale ; signaler un éventuel échec avec le système de toast global existant.
- Remplacer uniquement le montage de la sidebar dans `(app)/_layout.tsx`; conserver `src/app/components/sidebar/sidebar.tsx` et `src/app/components/ui/sidebar.tsx` inchangés.
- Sur desktop, afficher la marque et le lien simple Dashboard à gauche, une recherche purement visuelle réellement centrée, puis Paramètres et le menu utilisateur à droite.
- Sur mobile, utiliser un premier `Sheet` latéral comme menu burger avec Dashboard et Paramètres, centrer la marque et conserver l’avatar/menu utilisateur à droite. Une icône Recherche placée avec le burger ouvrira un second `Sheet` par le haut contenant le champ ; la recherche desktop sera masquée. Les panneaux se fermeront après navigation.

## Files to modify

- `src/app/pages/(app)/_layout.tsx` — retirer le montage de la sidebar et intégrer la navbar au-dessus du contenu.
- `src/app/components/navbar/navbar.tsx` — nouvelle navbar cliente, navigation desktop, menu burger mobile et menu utilisateur.
- `src/app/components/navbar/searchbar.tsx` — champ visuel réutilisable avec identifiants distincts pour les rendus desktop/mobile, label accessible et composition InputGroup simplifiée.
- `src/app/components/user-avatar.tsx` — extraire l’avatar et la logique d’initiales afin de les partager entre navbar et sidebar.
- `src/app/components/sidebar/sidebar.tsx` — remplacer uniquement son avatar interne par le composant partagé afin que la sidebar conservée reste fonctionnelle.

## Reuse

- `src/app/components/sidebar/sidebar.tsx` — logique existante de `getInitials`, avatar, menu utilisateur et déconnexion via `authClient.signOut()`.
- `src/app/components/sidebar/searchbar.tsx` — base actuelle de la recherche avec `Field` et `InputGroup`.
- `src/app/navigations.ts` — définition typée des routes Dashboard et Paramètres.
- `src/app/components/ui/{button,avatar,dropdown-menu,input-group,tooltip,separator,sheet}.tsx` — composants shadcn/Base UI déjà installés ; `Sheet` fournit le panneau burger accessible avec titre requis.
- `requireSession()` dans `src/libs/auth` — résolution serveur de l’utilisateur, déjà effectuée par le layout applicatif.
- `Link` et `useRouter` de Waku — navigation, préchargement, route active et redirection après déconnexion.

## Steps

- [x] Examiner le layout applicatif, la sidebar, la recherche et la configuration de navigation existants.
- [x] Confirmer Dashboard comme lien simple extensible, la recherche comme champ visuel et le format mobile burger + recherche en Sheet + marque centrée + avatar.
- [x] Créer la navbar et composer la marque/navigation avec les primitives shadcn.
- [x] Adapter la recherche centrée sur desktop ; sur mobile, ajouter une icône qui ouvre un `Sheet` supérieur titré contenant le champ.
- [x] Extraire l’avatar partagé, puis porter le menu utilisateur et l’accès Paramètres dans la zone droite, avec toast en cas d’échec de déconnexion.
- [x] Remplacer la sidebar dans le layout sans supprimer ses composants ni ses préférences.
- [x] Vérifier navigation, responsive, accessibilité, déconnexion et absence de régression.

## Verification

- Vérifier la marque et Dashboard à gauche, la recherche réellement centrée, puis Paramètres et le menu utilisateur à droite.
- Vérifier l’état actif des liens, les tooltips/libellés accessibles et la navigation clavier.
- Vérifier le popup utilisateur, les informations affichées, l’état pending et la redirection de déconnexion.
- Vérifier les largeurs desktop, tablette et mobile : burger et recherche à gauche, marque parfaitement centrée, avatar à droite, champ desktop sans chevauchement et champ mobile dans son Sheet.
- Confirmer que les pages d’authentification restent sans navbar applicative et que le code de sidebar est conservé.
- Exécuter les diagnostics TypeScript, `npm test` et `npm run build`.
