import { unstable_redirect } from "waku/router/server";

/** The Store page is gone: Apps lists the store apps that are not installed, behind its toggle. */
export default function StoreRedirect() {
  unstable_redirect("/apps", 308);
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
