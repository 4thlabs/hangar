import type { PageProps } from "waku/router";
import { unstable_redirect } from "waku/router/server";

/** The editor moved to /apps/<id>/edit with the Store page's removal; links and bookmarks still lead there. */
export default function StoreEditAppRedirect({ id }: PageProps<"/store/[id]/edit">) {
  unstable_redirect({ to: "/apps/[project]/edit", params: { project: id } }, 308);
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
