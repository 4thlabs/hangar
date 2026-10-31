"use client";

import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { Translate } from "#libs/i18n";
import { AppCommands } from "#modules/apps/actions/app-operation.ts";
import { ComposeConfirmDialog } from "#modules/apps/components/compose-operations.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import type { StoreActionResult } from "#modules/store/actions/store-action-result.ts";
import { StoreMessages } from "#modules/store/messages.ts";

/** What the button looks like in each state. Uninstalling keeps its wording and only spins. */
class ButtonFaces {
  static create(t: Translate<typeof StoreMessages.en>, appName: string) {
    const name = { name: appName };

    return {
      available: { title: t("button.install"), label: t("button.installApp", name), icon: <DownloadIcon /> },
      installing: { title: t("button.installing"), label: t("button.installingApp", name), icon: <Spinner /> },
      installed: { title: t("button.uninstall"), label: t("button.uninstallApp", name), icon: <Trash2Icon /> },
      uninstalling: { title: t("button.uninstall"), label: t("button.uninstallApp", name), icon: <Spinner /> },
    };
  }
}

function buttonState(installed: boolean, isPending: boolean): keyof ReturnType<typeof ButtonFaces.create> {
  if (installed) {
    return isPending ? "uninstalling" : "installed";
  }

  return isPending ? "installing" : "available";
}

type StoreAppButtonProps = {
  appId: string;
  appName: string;
  installed: boolean;
  installApp: (appId: string) => Promise<StoreActionResult>;
  uninstallApp: (appId: string) => Promise<StoreActionResult>;
};

/** A store card's only interactive part, split out so the card stays a server component. */
export function StoreAppButton({ appId, appName, installed, installApp, uninstallApp }: StoreAppButtonProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(StoreMessages);
  const [confirming, setConfirming] = useState(false);

  const handle = (action: () => Promise<StoreActionResult>, success: string, error: string) =>
    run(
      action,
      { success, error },
      // The list and its filter are computed server-side; refetch so both follow.
      () => router.reload(),
    );

  const install = () => handle(() => installApp(appId), t("button.installed"), t("button.installFailed"));

  const face = ButtonFaces.create(t, appName)[buttonState(installed, isPending)];

  const uninstall = () => {
    setConfirming(false);
    handle(() => uninstallApp(appId), t("button.uninstalled"), t("button.uninstallFailed"));
  };

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant={installed ? "outline" : "default"}
        className="absolute top-1.5 right-1.5"
        disabled={isPending}
        onClick={installed ? () => setConfirming(true) : install}
        aria-label={face.label}
        title={face.title}
      >
        {face.icon}
      </Button>
      {/* Reuses the apps confirmation: unlinking runs `docker compose down` first, same stakes. */}
      <ComposeConfirmDialog
        command={confirming ? AppCommands.create("down") : null}
        title={t("button.confirmTitle", { name: appName })}
        description={t("button.confirmDescription")}
        onConfirm={uninstall}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
