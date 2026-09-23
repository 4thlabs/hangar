"use client";

import { useState } from "react";
import type { ActionResult } from "#app/actions/action-result.ts";
import { CodeEditor } from "#app/components/ui/code-editor.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";

type YamlEditorOptions = {
  source: string;
  save: (value: string) => Promise<ActionResult>;
  titles: { success: string; error: string };
  onSaved: () => void;
  className: string;
};

/**
 * A YAML file edited in place and saved through a server action — `hangar.yml`, a store app's
 * compose file. Hands back the editor to place and the save to wire, so each caller keeps its own
 * layout around them.
 *
 * A refusal (schema, `docker compose config`) explains itself over several lines: a toast would
 * squash them, so they stay under the editor.
 */
export function useYamlEditor({ source, save, titles, onSaved, className }: YamlEditorOptions) {
  const { run, isPending } = useServerAction();
  const [value, setValue] = useState(source);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () =>
    run(
      () => save(value),
      titles,
      result => {
        setError(result && !result.success ? result.message : null);
        if (result?.success) onSaved();
      },
    );

  const editor = (
    <>
      <CodeEditor defaultValue={source} onChange={setValue} className={className} />
      {error && <pre className="text-sm whitespace-pre-wrap text-destructive">{error}</pre>}
    </>
  );

  return { editor, handleSave, isPending };
}
