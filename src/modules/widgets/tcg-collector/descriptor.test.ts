import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetConfigSchema } from "../config/widgets.ts";
import { aService } from "../mock/mock.ts";
import { CardImageId } from "./api/image-id.ts";
import { tcgCollectorCardsDescriptor } from "./descriptor.ts";

afterEach(() => vi.unstubAllGlobals());

const declaration = (fields: object) => ({
  type: "tcg-collector-cards",
  column: 2,
  url: "http://tcg-collector-web:8080",
  cards: [{ game: 1, product: 910771 }],
  ...fields,
});

describe("the tcg-collector-cards declaration", () => {
  it("mixes games in one list, and curves over 30 days unless told otherwise", () => {
    const parsed = widgetConfigSchema.safeParse(
      declaration({
        cards: [
          { game: 1, product: 910771 },
          { game: 21, product: 755143 },
        ],
      }),
    );

    expect(parsed.success && parsed.data).toMatchObject({
      cards: [
        { game: 1, product: 910771 },
        { game: 21, product: 755143 },
      ],
      days: 30,
    });
  });

  it.each([1, 3650])("takes %i days, within what tcg-collector serves", days => {
    expect(widgetConfigSchema.safeParse(declaration({ days })).success).toBe(true);
  });

  it.each([0, 3651, 1.5, "30"])("rejects %o as a period", days => {
    expect(widgetConfigSchema.safeParse(declaration({ days })).success).toBe(false);
  });

  it.each([-1, 1_000_000_000, 1.5, "910771"])("rejects %o as a product id, as tcg-collector would", product => {
    expect(widgetConfigSchema.safeParse(declaration({ cards: [{ game: 1, product }] })).success).toBe(false);
  });

  it("wants at least one card, a game for each, and no more than twenty", () => {
    const twentyOne = Array.from({ length: 21 }, (_, index) => ({ game: 1, product: index }));

    expect(widgetConfigSchema.safeParse(declaration({ cards: [] })).success).toBe(false);
    expect(widgetConfigSchema.safeParse(declaration({ cards: undefined })).success).toBe(false);
    expect(widgetConfigSchema.safeParse(declaration({ cards: [{ product: 910771 }] })).success).toBe(false);
    expect(widgetConfigSchema.safeParse(declaration({ cards: twentyOne })).success).toBe(false);
  });
});

describe("CardImageId", () => {
  it("reads back the card it was made from", () => {
    const id = CardImageId.format({ game: 21, product: 755143 });

    expect(id).toBe("21-755143");
    expect(CardImageId.parse(id)).toEqual({ game: 21, product: 755143 });
  });

  it.each(["910771", "1-", "-910771", "1-910771-2", "1-1234567890", "a-1", "1.5-2"])("issues nothing for %o", id => {
    expect(CardImageId.parse(id)).toBeUndefined();
  });
});

describe("the tcg-collector-cards relay", () => {
  const relay = (id: string) =>
    tcgCollectorCardsDescriptor.relay!(aService({ api: "http://tcg-collector-web:8080" }), id);

  it("asks for the small image of the card in its own game", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(new Response("webp-bytes", { headers: { "content-type": "image/webp" } }));
    });

    const image = await relay("21-755143");

    expect(called.map(request => request.url)).toEqual([
      "http://tcg-collector-web:8080/api/image?game=21&product=755143&size=small",
    ]);

    expect(image?.headers.get("content-type")).toBe("image/webp");
  });

  it("answers nothing for a card with no image, rather than failing", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ error: "No image" }, { status: 404 })));

    expect(await relay("1-910771")).toBeUndefined();
  });

  it("asks nothing for an id the widget never issues", async () => {
    vi.stubGlobal("fetch", vi.fn());

    expect(await relay("910771")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still fails when tcg-collector itself does", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ error: "The server could not answer" }, { status: 500 })),
    );

    await expect(relay("1-910771")).rejects.toThrow();
  });
});
