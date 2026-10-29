import { unstable_redirect } from "waku/router/server";

/** The page moved to /apps/new with the Store page's removal; links and bookmarks still lead there. */
export default function StoreNewAppRedirect() {
  unstable_redirect("/apps/new", 308);
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
