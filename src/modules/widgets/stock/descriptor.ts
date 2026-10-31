import * as z from "zod";
import { columnSchema, describeWidget, ttlField, WidgetIcon } from "../config/config.ts";
import { StockMessages } from "./messages.ts";

/**
 * A symbol as Finnhub writes it: `AAPL`, a share class `BRK.B`, or a listing outside the US with its exchange suffix,
 * `AIR.PA` or `005930.KS`.
 */
const symbolSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9.-]{0,19}$/, "must be an uppercase symbol, such as AAPL, BRK.B or AIR.PA");

/** Reads the public Finnhub API, not a store app: no service to declare, the key is `FINNHUB_API_KEY`. */
export const stockPricesDescriptor = describeWidget({
  schema: z.object({
    type: z.literal("stock-prices"),
    column: columnSchema,
    ...ttlField,
    tickers: z
      .array(symbolSchema)
      .min(1)
      .max(10)
      .refine(tickers => new Set(tickers).size === tickers.length, "ticker symbols must be unique"),
  }),
  appearance: {
    messages: StockMessages,
    icon: new WidgetIcon("/images/widgets/stock.svg"),
    className: "min-h-64",
  },
  module: () => import("./stock.tsx"),
  create: ({ stockPrices }, config) => stockPrices(config.tickers),
});
