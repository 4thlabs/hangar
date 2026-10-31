"use client";

import type { EditorView } from "@codemirror/view";
import { SaveIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "waku";
import { ServiceList } from "#modules/apps/components/service-list.tsx";
import { useDockerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CodeEditor } from "#modules/common/ui/code-editor.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { AppFileTree } from "#modules/store/components/app-file-tree.tsx";
import { COMPOSE_FILE } from "#modules/store/compose-file.ts";
import { ComposeServiceMarkers } from "#modules/store/compose-service-markers.ts";
import { useAppFiles, type AppFilesOptions } from "#modules/store/hooks/use-app-files.ts";
import { useAppServices } from "#modules/store/hooks/use-app-services.ts";
import { StoreMessages } from "#modules/store/messages.ts";

type AppEditorProps = Omit<AppFilesOptions, "onSaved">;

/**
 * Edits every file of a store app: the file tree and the app's live services on the left, the open file beside
 * them. In the compose file, each service carries its state at the end of its line.
 */
export function AppEditor(props: AppEditorProps) {
  const router = useRouter();
  const { t, locale } = useTranslation(StoreMessages);
  const viewRef = useRef<EditorView | null>(null);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  // A service to scroll to once the compose file is open: a click from another file has to wait for its editor.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  // Built once: the editor reads its extensions when it mounts, and the setter never changes.
  const [markerExtension] = useState(() => ComposeServiceMarkers.extension(setExpandedService));

  const services = useAppServices(props.id);
  const containerIds = services?.state === "loaded" ? services.detail.containerIds : [];
  const { stats } = useDockerStats(containerIds);

  const markers = useMemo(() => ComposeServiceMarkers.create(services, stats, locale), [services, stats, locale]);

  const files = useAppFiles({
    ...props,
    onSaved: ({ composeChanged }) => {
      // The compose file may rename the app or change its icon, which the page and the store list show.
      // The server tells, as an alias or another case may lead to it.
      if (composeChanged) {
        router.reload();
      }
    },
  });

  const isComposeOpen = files.selectedPath === COMPOSE_FILE;

  // On each reading and each stats frame, and when the compose file opens again in a new editor. A marker whose
  // text did not change is not redrawn.
  useEffect(() => {
    if (isComposeOpen) {
      viewRef.current?.dispatch({ effects: ComposeServiceMarkers.update.of(markers) });
    }
  }, [markers, isComposeOpen]);

  useEffect(() => {
    if (!pendingReveal || !isComposeOpen || !viewRef.current) {
      return;
    }

    ComposeServiceMarkers.reveal(viewRef.current, pendingReveal);
    setPendingReveal(null);
  }, [pendingReveal, isComposeOpen]);

  /** Unfolds a service, or folds it back, and shows where the compose file declares it. */
  function selectService(service: string) {
    if (expandedService === service) {
      setExpandedService(null);

      return;
    }

    setExpandedService(service);
    setPendingReveal(service);

    if (!isComposeOpen) {
      files.select(COMPOSE_FILE);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(12rem,16rem)_1fr]">
      <div className="flex min-w-0 flex-col gap-3">
        <AppFileTree
          paths={files.paths}
          selectedPath={files.selectedPath}
          unsavedPaths={files.unsavedPaths}
          onSelect={files.select}
          onCreate={files.create}
          isCreating={files.isPending}
        />
        <ServiceList
          project={props.id}
          services={services}
          stats={stats}
          expandedService={expandedService}
          onSelect={selectService}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="font-mono text-sm text-muted-foreground">{files.selectedPath}</p>
        {files.selectedDraft === undefined ? (
          <div className="flex h-[65vh] items-center justify-center rounded-lg border border-input">
            {files.isLoading && <Spinner />}
          </div>
        ) : (
          <CodeEditor
            key={files.selectedPath}
            defaultValue={files.selectedDraft}
            onChange={files.updateDraft}
            className="h-[65vh]"
            extensions={isComposeOpen ? [markerExtension] : []}
            viewRef={viewRef}
          />
        )}
        {files.error && <pre className="text-sm whitespace-pre-wrap text-destructive">{files.error}</pre>}
        <PendingButton
          type="button"
          className="self-start"
          pending={files.isPending}
          pendingLabel={t("editor.validating")}
          icon={<SaveIcon data-icon="inline-start" />}
          disabled={files.selectedDraft === undefined}
          onClick={files.save}
        >
          {t("editor.save")}
        </PendingButton>
      </div>
    </div>
  );
}
