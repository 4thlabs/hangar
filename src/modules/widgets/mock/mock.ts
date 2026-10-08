import { fulfilled } from "#libs/cache";
import type { WidgetDescriptor, WidgetService } from "../config/config.ts";
import { defineWidget, type Widget, type WidgetBody } from "../shared/define-widget.tsx";

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

/** A widget built straight from its descriptor and body, as the registry builds one once its module has loaded. */
export const aWidget = (descriptor: WidgetDescriptor, body: WidgetBody): Widget =>
  defineWidget({ id: "test-widget", appearance: descriptor.appearance, body: () => fulfilled(body) });
