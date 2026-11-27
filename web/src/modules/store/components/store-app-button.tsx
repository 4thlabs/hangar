import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import type { StoreApp } from "#libs/api";
import { ConfirmDialog } from "#modules/common/components/confirm-dialog.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { storeMutations } from "#modules/store/api/store-queries.ts";
import { m } from "#paraglide/messages.js";

type StoreAppButtonProps = {
  app: StoreApp;
};

/** What the button of a card says in each state. Uninstalling keeps its wording and only spins. */
function buttonFace(app: StoreApp, isPending: boolean) {
  if (app.installed) {
    return {
      title: m.store_install_uninstall(),
      label: m.store_install_uninstall_app({ name: app.name }),
      icon: isPending ? <Spinner /> : <Trash2Icon />,
    };
  }

  if (isPending) {
    return {
      title: m.store_install_installing(),
      label: m.store_install_installing_app({ name: app.name }),
      icon: <Spinner />,
    };
  }

  return {
    title: m.store_install_install(),
    label: m.store_install_install_app({ name: app.name }),
    icon: <DownloadIcon />,
  };
}

/** A card's install or uninstall, the latter confirmed first: it takes the app's containers down. */
export function StoreAppButton({ app }: StoreAppButtonProps) {
  const [confirming, setConfirming] = useState(false);

  // The options read the list again whatever the outcome; the toasts are this button's, set beside them rather than on
  // `mutate`, so that they show even when the list read again leaves this card out.
  const install = useMutation({
    ...storeMutations.install(),
    onSuccess: () =>
      toastSuccess(m.store_install_installed(), m.store_install_installed_description({ name: app.name })),
    onError: error => toastFailure(m.store_install_install_failed(), error),
  });

  const uninstall = useMutation({
    ...storeMutations.uninstall(),
    onSuccess: () =>
      toastSuccess(m.store_install_uninstalled(), m.store_install_uninstalled_description({ name: app.name })),
    onError: error => toastFailure(m.store_install_uninstall_failed(), error),
  });

  const isPending = install.isPending || uninstall.isPending;
  const face = buttonFace(app, isPending);

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
        title={m.store_install_confirm_title({ name: app.name })}
        description={m.store_install_confirm_description()}
        confirmLabel={m.store_install_uninstall()}
        destructive
        onConfirm={confirmUninstall}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
