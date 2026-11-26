import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { getStoreAppsQueryKey, useStoreInstall, useStoreUninstall, type StoreApp } from "#libs/api";
import { ActionToast } from "#modules/common/action-toast.ts";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";

type StoreAppButtonProps = {
  app: StoreApp;
};

/** What the button of a card says in each state. Uninstalling keeps its wording and only spins. */
class ButtonFaces {
  static of(app: StoreApp, isPending: boolean) {
    if (app.installed) {
      return { title: "Uninstall", label: `Uninstall ${app.name}`, icon: isPending ? <Spinner /> : <Trash2Icon /> };
    }

    if (isPending) {
      return { title: "Installing…", label: `Installing ${app.name}`, icon: <Spinner /> };
    }

    return { title: "Install", label: `Install ${app.name}`, icon: <DownloadIcon /> };
  }
}

/** A card's install or uninstall, the latter confirmed first: it takes the app's containers down. */
export function StoreAppButton({ app }: StoreAppButtonProps) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  // The list and its counts follow the change, whatever its outcome: another process may have made it meanwhile.
  const settled = () => queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() });

  const install = useStoreInstall({
    mutation: {
      onSuccess: () => ActionToast.success("App installed", `${app.name} was installed.`),
      onError: error => ActionToast.failure("Installation failed", error),
      onSettled: settled,
    },
  });

  const uninstall = useStoreUninstall({
    mutation: {
      onSuccess: () => ActionToast.success("App uninstalled", `${app.name} was uninstalled.`),
      onError: error => ActionToast.failure("Uninstallation failed", error),
      onSettled: settled,
    },
  });

  const isPending = install.isPending || uninstall.isPending;
  const face = ButtonFaces.of(app, isPending);

  const confirmUninstall = () => {
    setConfirming(false);
    uninstall.mutate({ id: app.id });
  };

  return (
    <>
      <Button
        type="button"
        size="icon-xs"
        variant={app.installed ? "outline" : "default"}
        className="absolute top-1.5 right-1.5"
        disabled={isPending}
        onClick={app.installed ? () => setConfirming(true) : () => install.mutate({ id: app.id })}
        aria-label={face.label}
        title={face.title}
      >
        {face.icon}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={`Uninstall ${app.name}?`}
        description="The app's containers are stopped and removed, then the app is taken off the installed apps. The volumes are kept."
        confirmLabel="Uninstall"
        destructive
        onConfirm={confirmUninstall}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
