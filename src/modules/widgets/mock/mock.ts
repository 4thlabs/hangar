import type { WidgetService } from "../config/config.ts";

export { clearWidgetCache } from "../shared/define-widget.tsx";

/** What `HangarEnv` answers for a variable the operator never filled in. */
export const noSecret = () => Promise.resolve(undefined);

/** A service widget's addresses for tests: no key, placeholder addresses; override what a test cares about. */
export const aService = (overrides: Partial<WidgetService> = {}): WidgetService => ({
  api: "http://service:8080",
  link: "https://service.test.local",
  apiKey: noSecret,
  ...overrides,
});
