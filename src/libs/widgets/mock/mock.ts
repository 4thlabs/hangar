import type { WidgetService } from "../config/config.ts";

export { clearWidgetCache } from "../shared/define-widget.tsx";

/** What `HangarEnv` answers for a variable the operator never filled in. */
export const noSecret = () => Promise.resolve(undefined);

/**
 * A service widget's addresses, for tests.
 *
 * Defaults to a service that takes no key and lives nowhere in particular: a test that cares
 * about an address says so, and one that only needs *a* service says nothing.
 */
export const aService = (overrides: Partial<WidgetService> = {}): WidgetService => ({
  api: "http://service:8080",
  link: "https://service.test.local",
  apiKey: noSecret,
  ...overrides,
});
