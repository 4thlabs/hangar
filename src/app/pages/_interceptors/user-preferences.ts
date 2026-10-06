import { unstable_getHeaders as getHeaders, type HandlerInterceptor } from "waku/router/server";
import { userPreferences, UserPreferencesStore } from "#libs/preferences/server";

const userPreferencesInterceptor: HandlerInterceptor = next => {
  const preferences = UserPreferencesStore.parse(getHeaders().cookie ?? "");

  return userPreferences.run(preferences, next);
};

export default userPreferencesInterceptor;
