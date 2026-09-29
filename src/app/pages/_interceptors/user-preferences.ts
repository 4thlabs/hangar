import type { HandlerInterceptor } from "waku/router/server";
import { unstable_getHeaders as getHeaders } from "waku/router/server";
import { UserPreferencesStore, userPreferences } from "#libs/preferences/server";

const userPreferencesInterceptor: HandlerInterceptor = next => {
  const preferences = UserPreferencesStore.parse(getHeaders().cookie ?? "");
  return userPreferences.run(preferences, next);
};

export default userPreferencesInterceptor;
