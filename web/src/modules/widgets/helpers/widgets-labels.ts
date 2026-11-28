import { m } from "#paraglide/messages.js";

/** The words of each value `widgets` shows a label of. */
export const widgetsLabels = {
  /** The games tcg-collector collects, by Cardmarket's game id. */
  games: new Map<number, () => string>([
    [1, m.widgets_games_magic],
    [21, m.widgets_games_star_wars_unlimited],
  ]),
};
