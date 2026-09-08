# Plan — Widget Frigate

## Context

Ajouter à Hangar le widget Frigate déjà utilisé dans Glance (`../homelab/store/glance/config/widgets/frigate/events.yml`). La référence affiche un résumé (nombre de caméras, débit de détection, temps d’inférence de chaque détecteur) puis les cinq événements les plus récents avec vignette, label/sous-label, caméra et date relative. La couche serveur doit rester minimale sous `src/libs/api/frigate`.

## Approach

- Reproduire exactement les informations du widget Glance dans une `Card` React serveur : nombre de caméras, débit global de détection, temps d’inférence par détecteur, puis cinq événements récents.
- Faire en parallèle les deux lectures Frigate nécessaires : `GET /api/events` avec `searchParams: { limit: 5 }` et `GET /api/stats`. Le client validera explicitement la présence de `FRIGATE_URL` avant l’appel. Aucun mécanisme d’authentification n’est requis sur cette URL interne.
- Limiter les types à `FrigateEvent` (`id`, `camera`, `label`, `sub_label`, `start_time`) et `FrigateStats` (`detection_fps`, clés de `cameras`, `detectors.*.inference_speed`).
- Séparer, comme pour Arcane, une vue pure testable d’un wrapper asynchrone. Le wrapper attendra les deux appels, journalisera les détails d’échec côté serveur uniquement et remplacera seulement cette carte par une erreur générique. Un skeleton de mêmes proportions servira de fallback `Suspense`.
- Utiliser `FRIGATE_URL` uniquement pour les appels serveur. Exporter l’URL publique `https://frigate.${DOMAIN}` pour le titre, les vignettes `/api/events/{id}/thumbnail.jpg` et les liens `/explore?event_id={id}` ouverts dans un nouvel onglet.
- Afficher les vignettes en 16:9 avec chargement différé, le label et l’éventuel sous-label, le nom de caméra nettoyé comme dans Glance (`frigate_` retiré, `_` remplacés par des espaces), puis un âge relatif calculé côté serveur avec les API `Intl` natives, sans ajouter de dépendance.
- Ajouter la carte dans la colonne de droite sur desktop, comme dans la page Glance source ; elle occupera la seconde colonne en tablette et suivra les widgets Arcane en mobile.

## Files to modify

- `src/libs/api/frigate/client.ts` — client serveur et appels `events`/`stats`.
- `src/libs/api/frigate/type.ts` et `src/libs/api/frigate/index.ts` — types minimaux et exports.
- `src/libs/api/index.ts` — export public Frigate.
- `src/libs/widgets/frigate/events.tsx` — carte, wrapper serveur, skeleton et erreur.
- `src/libs/widgets/frigate/events.test.tsx` et `src/libs/widgets/frigate/index.ts` — tests de rendu et exports.
- `src/libs/widgets/index.ts` — export public du widget.
- `src/app/pages/(app)/index.tsx` — insertion du widget sur le dashboard.
- `.env.example` — documenter la configuration Frigate nécessaire.

## Reuse

- `../homelab/store/glance/config/widgets/frigate/events.yml` et son `README.md` — endpoints, champs, limite de cinq événements et séparation URL interne/publique vérifiés par le widget actuel.
- `src/libs/api/arcane/client.ts` — conventions `ky` et chargement serveur des variables d’environnement.
- `src/libs/widgets/arcane/general-stats.tsx` — structure vue pure/wrapper asynchrone, `Card`, état d’erreur et skeleton.
- `src/app/components/icon-selfh.tsx` — icône Frigate via le catalogue selfh.st.

## Steps

- [x] Identifier la référence Glance, ses deux endpoints, ses chemins JSON et son emplacement.
- [x] Confirmer la reprise exacte des statistiques et des cinq événements, ainsi que la séparation URL interne/publique.
- [x] Créer les types Frigate minimaux et le client `ky` serveur avec appels `events`/`stats` parallélisables.
- [x] Construire la carte Frigate pure : en-tête lié, résumé des statistiques, liste des événements, état vide et dates relatives.
- [x] Ajouter le wrapper serveur, l’erreur isolée et le skeleton.
- [x] Exporter l’API et le widget depuis les index existants, documenter `FRIGATE_URL` et monter la carte sous `Suspense` dans la colonne droite du dashboard.
- [x] Ajouter les tests de rendu statique couvrant statistiques, événement avec/sans sous-label, transformation du nom de caméra, URLs publiques, liste vide et erreur générique.

## Verification

- Exécuter les diagnostics TypeScript/LSP sur tous les fichiers TypeScript/TSX touchés, puis `lens_diagnostics` en mode `all`.
- Exécuter `npm test`, puis `npm run build`.
- Avec `FRIGATE_URL=http://frigate:5000` et `DOMAIN` configuré, ouvrir `/` et comparer les statistiques ainsi que les cinq événements avec le widget Glance et Frigate.
- Vérifier les liens externes, le chargement des miniatures derrière la session OIDC et le rendu des âges relatifs.
- Vérifier mobile, tablette et desktop, les thèmes clair/sombre, puis les états sans événement, API interne indisponible et `FRIGATE_URL` absente ; les erreurs Frigate ne doivent pas empêcher le reste du dashboard de fonctionner.
