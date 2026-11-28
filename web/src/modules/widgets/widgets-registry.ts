import type { WidgetType } from "#libs/api";
import { arcaneWidget } from "#modules/widgets/components/cards/arcane-card.tsx";
import { backrestWidget } from "#modules/widgets/components/cards/backrest-card.tsx";
import { beszelWidget } from "#modules/widgets/components/cards/beszel-card.tsx";
import { clockWidget } from "#modules/widgets/components/cards/clock-card.tsx";
import { dockerWidget } from "#modules/widgets/components/cards/docker-card.tsx";
import { forgejoWidget } from "#modules/widgets/components/cards/forgejo-card.tsx";
import { frigateWidget } from "#modules/widgets/components/cards/frigate-card.tsx";
import { githubWidget } from "#modules/widgets/components/cards/github-card.tsx";
import { gluetunWidget } from "#modules/widgets/components/cards/gluetun-card.tsx";
import { jellyfinWidget } from "#modules/widgets/components/cards/jellyfin-card.tsx";
import { minifluxWidget } from "#modules/widgets/components/cards/miniflux-card.tsx";
import { stockWidget } from "#modules/widgets/components/cards/stock-card.tsx";
import { tcgCollectorWidget } from "#modules/widgets/components/cards/tcg-collector-card.tsx";
import type { WidgetEntry } from "#modules/widgets/define-widget.ts";

/** Every widget's entry, by its type: a type of the contract with no entry is a type error. */
type Registry = { readonly [Type in WidgetType]: WidgetEntry<Type> };

// Annotated with its type rather than checked with `satisfies`: indexed by a generic type, the object's own type gives
// the union of every entry, which TypeScript refuses as the entry of that one type (TS2322, or TS2375 as
// `exactOptionalPropertyTypes` words it here). The mapped type keeps the type of each entry tied to its key.
const widgets: Registry = {
  clock: clockWidget,
  "docker-general-stats": dockerWidget,
  "arcane-general-stats": arcaneWidget,
  "backrest-summary": backrestWidget,
  "beszel-server-stats": beszelWidget,
  "forgejo-ci": forgejoWidget,
  "frigate-events": frigateWidget,
  "gluetun-vpn-status": gluetunWidget,
  "miniflux-entries": minifluxWidget,
  "jellyfin-latest": jellyfinWidget,
  "tcg-collector-cards": tcgCollectorWidget,
  "github-releases": githubWidget,
  "stock-prices": stockWidget,
};

/** The entry of the widget of `type`: its looks, its words and its card. */
export function widgetEntry<Type extends WidgetType>(type: Type): WidgetEntry<Type> {
  return widgets[type];
}
