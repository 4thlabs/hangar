/** Which card an image shows: a product id is only unique within its game. */
export type CardImageRef = {
  game: number;
  product: number;
};

/**
 * The relay id of a card's image, `<game>-<product>`. The relay hands a widget the id alone, not its placement, so the
 * id carries the game too.
 */
export class CardImageId {
  /** Both parts as tcg-collector's API accepts them: one to nine digits. */
  private static readonly Pattern = /^(\d{1,9})-(\d{1,9})$/;

  static format({ game, product }: CardImageRef) {
    return `${game}-${product}`;
  }

  /** The card an id names, or `undefined` for an id this widget never issues. */
  static parse(id: string): CardImageRef | undefined {
    const match = CardImageId.Pattern.exec(id);

    if (!match) {
      return undefined;
    }

    return { game: Number(match[1]), product: Number(match[2]) };
  }
}
