"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { useAtom } from "jotai";
import { SearchIcon } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "waku";
import { useLocale, useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Badge } from "#modules/common/ui/badge.tsx";
import { Dialog, DialogContent, DialogTitle } from "#modules/common/ui/dialog.tsx";
import { spotlightAtom } from "#modules/spotlight/atoms/spotlight.ts";
import { useSpotlightPlatform } from "#modules/spotlight/hooks/use-spotlight-platform.ts";
import { useSpotlightResults } from "#modules/spotlight/hooks/use-spotlight-results.ts";
import { useSpotlightShortcuts } from "#modules/spotlight/hooks/use-spotlight-shortcuts.ts";
import { SpotlightMessages } from "#modules/spotlight/messages.ts";
import { SpotlightSources } from "#modules/spotlight/sources.ts";
import {
  Spotlight,
  type SpotlightAction,
  type SpotlightItem,
  type SpotlightPlatform,
  type SpotlightSource,
} from "#modules/spotlight/spotlight.ts";

/** One source's matches, as Base UI groups them: it reads `items` and leaves the rest to the renderer. */
type SpotlightGroup = { source: SpotlightSource; items: SpotlightItem[] };

/**
 * The search palette: every source, or the one its shortcut or prefix names. Mounted once, in the navbar; the
 * button and the shortcuts open it through {@link spotlightAtom}.
 */
export function SpotlightPalette() {
  const [state, setState] = useAtom(spotlightAtom);
  const { t, locale } = useTranslation(SpotlightMessages);
  const [input, setInput] = useState("");
  const [highlighted, setHighlighted] = useState<SpotlightItem | undefined>(undefined);
  const results = useSpotlightResults(state.open, state.scope);
  const platform = useSpotlightPlatform();
  const router = useRouter();

  useSpotlightShortcuts();

  const scope = SpotlightSources.find(state.scope);
  const sources = scope ? [scope] : SpotlightSources.All;
  const query = input.trim();

  // Memoized: every arrow key moves the highlight and re-renders the palette, and fresh arrays would make Base UI
  // recompute its own lists each time.
  const groups = useMemo(
    () =>
      (scope ? [scope] : SpotlightSources.All).flatMap((source): SpotlightGroup[] => {
        const result = results.get(source.id);
        const items = result?.status === "ready" ? Spotlight.filter(query, result.items) : [];

        return items.length > 0 ? [{ source, items }] : [];
      }),
    [scope, results, query],
  );

  const failed = sources.filter(source => results.get(source.id)?.status === "failed");
  const isLoading = sources.some(source => !results.has(source.id));

  function handleOpenChange(open: boolean) {
    setState(current => ({ open, scope: open ? current.scope : null }));

    if (!open) {
      setInput("");
    }
  }

  /** A prefix typed first narrows the search, then leaves the field: the badge shows the scope from there. */
  function handleInputChange(value: string) {
    const parsed = Spotlight.parse(value, SpotlightSources.All);

    if (!scope && parsed.scope) {
      setState({ open: true, scope: parsed.scope.id });
      setInput(parsed.query);

      return;
    }

    setInput(value);
  }

  function perform(action: SpotlightAction) {
    Spotlight.perform(action, {
      push: to => router.push(to),
      open: url => window.open(url, "_blank", "noopener"),
    });

    handleOpenChange(false);
  }

  /**
   * Base UI leaves Enter alone as soon as a modifier is held, so every modified Enter is read here: ⌘ (Ctrl off Apple
   * devices), with or without Shift, picks another action, and any other modifier does what Enter does.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const isModifiedEnter = event.key === "Enter" && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

    if (isModifiedEnter && highlighted) {
      event.preventDefault();
      perform(Spotlight.action(highlighted, Spotlight.actionKey(event, platform)));

      return;
    }

    if (event.key === "Backspace" && input === "" && scope) {
      setState({ open: true, scope: null });
    }
  }

  function handleItemClick(item: SpotlightItem, event: MouseEvent) {
    perform(Spotlight.action(item, Spotlight.actionKey(event, platform)));
  }

  return (
    <Dialog open={state.open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15svh] flex max-h-[70svh] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{t("search")}</DialogTitle>
        <Autocomplete.Root
          open
          inline
          mode="none"
          autoHighlight="always"
          keepHighlight
          items={groups}
          filteredItems={groups}
          itemToStringValue={(item: SpotlightItem) => item.label}
          value={input}
          onValueChange={handleInputChange}
          onItemHighlighted={setHighlighted}
        >
          <Autocomplete.InputGroup className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {scope && <Badge variant="secondary">{scope.label(locale)}</Badge>}
            <Autocomplete.Input
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label={t("search")}
              placeholder={scope ? t("scopedPlaceholder", { source: scope.label(locale) }) : t("placeholder")}
              onKeyDown={handleKeyDown}
            />
          </Autocomplete.InputGroup>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            <Autocomplete.Empty>
              <p className="px-3 py-6 text-center text-muted-foreground">{isLoading ? t("loading") : t("empty")}</p>
            </Autocomplete.Empty>
            <Autocomplete.List>
              {(group: SpotlightGroup) => (
                <Autocomplete.Group key={group.source.id} items={group.items} className="not-last:mb-2">
                  <Autocomplete.GroupLabel className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.source.label(locale)}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>
                    {(item: SpotlightItem) => (
                      <Autocomplete.Item
                        key={item.id}
                        value={item}
                        onClick={event => handleItemClick(item, event)}
                        className="flex cursor-default items-center gap-3 rounded-md px-3 py-2 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <SpotlightIcon icon={item.icon} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{item.actions.enter.label}</span>
                      </Autocomplete.Item>
                    )}
                  </Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>
            {failed.map(source => (
              <p key={source.id} role="alert" className="px-3 py-2 text-destructive">
                {t("sourceFailed", { source: source.label(locale) })}
              </p>
            ))}
          </div>
        </Autocomplete.Root>
        <SpotlightFooter highlighted={highlighted} scope={scope} platform={platform} />
      </DialogContent>
    </Dialog>
  );
}

function SpotlightIcon({ icon: Icon }: { icon: SpotlightItem["icon"] }) {
  if (Icon === undefined) {
    return <span className="size-5 shrink-0" />;
  }

  if (typeof Icon === "string") {
    return <img src={Icon} alt="" className="size-5 shrink-0 object-contain" />;
  }

  return <Icon className="size-5 shrink-0 text-muted-foreground" />;
}

type SpotlightFooterProps = {
  highlighted: SpotlightItem | undefined;
  scope: SpotlightSource | null;
  platform: SpotlightPlatform;
};

/** What each key does on the highlighted item, and, before a scope is picked, how to pick one. */
function SpotlightFooter({ highlighted, scope, platform }: SpotlightFooterProps) {
  const locale = useLocale();

  // Only the keys the item gives an action of its own: the others repeat Enter's.
  const hints = Spotlight.ActionKeys.flatMap(({ name, shortcut }) => {
    const action = highlighted?.actions[name];

    return action ? [{ name, shortcut, action }] : [];
  });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      {hints.map(({ name, shortcut, action }) => (
        <span key={name}>
          <kbd>{Spotlight.label(shortcut, platform)}</kbd> {action.label}
        </span>
      ))}
      {!scope && (
        <span className="ml-auto flex gap-3">
          {SpotlightSources.All.map(source => (
            <span key={source.id}>
              <kbd>{source.prefix}</kbd> {source.label(locale)} ·{" "}
              <kbd>{Spotlight.label(source.shortcut, platform)}</kbd>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
