"use client";

import { ListFilterIcon } from "lucide-react";
import { Button } from "#app/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#app/components/ui/dropdown-menu.tsx";

type FilterOption = {
  value: string;
  label: string;
  /** How many rows carry this value, shown beside the checkbox. */
  count?: number;
};

type CheckboxFilterMenuProps = {
  /** Names the dimension being filtered, e.g. "Statut". */
  label: string;
  options: FilterOption[];
  selected: readonly string[];
  /** Receives the new selection, in `options` order. */
  onChange: (selected: string[]) => void;
};

/**
 * A multi-select filter as a dropdown of checkboxes. An empty selection means "no filter",
 * so the unfiltered view needs no "all" option.
 *
 * Shared by the apps and store filters: the two stay identical because they are the same
 * component, not because someone remembered to copy a change across.
 */
export function CheckboxFilterMenu({ label, options, selected, onChange }: CheckboxFilterMenuProps) {
  const toggle = (value: string, checked: boolean) =>
    // Rebuilt from `options` so the selection keeps a stable order whatever the click order.
    onChange(
      options
        .map(option => option.value)
        .filter(candidate => (candidate === value ? checked : selected.includes(candidate))),
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
        <ListFilterIcon data-icon="inline-start" />
        {label}
        {selected.length > 0 && <span className="text-muted-foreground">· {selected.length}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
        {options.map(option => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.includes(option.value)}
            onCheckedChange={checked => toggle(option.value, checked)}
          >
            <span className="flex-1">{option.label}</span>
            {option.count !== undefined && <span className="text-muted-foreground tabular-nums">{option.count}</span>}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={selected.length === 0} onClick={() => onChange([])}>
          Tout effacer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
