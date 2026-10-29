"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "#modules/common/ui/button.tsx";

type UninstalledToggleProps = {
  shown: boolean;
  /** How many store apps are not installed, shown beside the label. */
  count: number;
  onChange: (shown: boolean) => void;
};

/** Shows or hides the store apps that are not installed, on Apps and Cluster alike. */
export function UninstalledToggle({ shown, count, onChange }: UninstalledToggleProps) {
  return (
    <Button
      type="button"
      variant={shown ? "secondary" : "outline"}
      aria-pressed={shown}
      onClick={() => onChange(!shown)}
    >
      {shown ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
      Non installées
      <span className="text-muted-foreground tabular-nums">· {count}</span>
    </Button>
  );
}
