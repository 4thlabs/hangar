import * as z from "zod";
import { describeWidget, WidgetIcon, WidgetSchema } from "../config/config.ts";

/** A stock ticker symbol: uppercase letters and digits, 1–5 chars. */
const tickerSymbol = z.string().regex(/^[A-Z0-9]{1,5}$/, "must be 1–5 uppercase letters or digits");

/** A currency code: three uppercase letters (ISO 4217). */
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "must be a 3-letter ISO 4217 code (e.g. USD, EUR)");

/** Stock prices tracked via Finnhub: current quotes and 30-day sparklines. */
export const stockPricesDescriptor = describeWidget({
  schema: WidgetSchema.service("stock-prices").extend({
    tickers: z
      .array(tickerSymbol)
      .min(1)
      .max(10)
      .refine(tickers => new Set(tickers).size === tickers.length, "ticker symbols must be unique"),
    currency: currencyCode.default("USD"),
  }),
  app: "finnhub",
  appearance: {
    title: "Stocks",
    icon: new WidgetIcon("/images/widgets/stock.svg"),
    className: "min-h-64",
    errorDescription: "The stock prices could not be loaded.",
  },
  module: () => import("./stock.tsx"),
  create: ({ stockWidget }, config, service) => stockWidget(service(), config),
});
