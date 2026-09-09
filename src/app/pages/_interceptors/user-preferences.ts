import type { HandlerInterceptor } from "waku/router/server";
import { unstable_getHeaders as getHeaders } from "waku/router/server";
import { parseUserPreferences, runWithUserPreferences } from "#libs/preferences";

const userPreferencesInterceptor: HandlerInterceptor = next => {
  const preferences = parseUserPreferences(getHeaders().cookie ?? "");
  return runWithUserPreferences(preferences, next);
};

export default userPreferencesInterceptor;
