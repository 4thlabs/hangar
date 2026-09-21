# `#libs/widgets` — what is written twice

A pass over `src/libs/widgets` looking only for repetition and missing
mutualisation. Ranked by lines removed per line added. Nothing here is a bug; all
of it is code that exists twice and can only drift.

**Status.** §§2-6 are applied. §1 — the Arcane/Docker metric grid — and §7 are
still open, and §1 is the only one of the seven worth calling a refactor.

---

## 1. Arcane and Docker render the same four metrics, twice

`arcane/general-stats.tsx:66-79` and `docker/general-stats.tsx:51-64` are the same
fourteen lines. Same labels, same `stopped > 0 ? "destructive"` rule, same
`"{n} unused · {size}"` and `"{n} in use · {n} unused"` templates. A `diff` of the
two blocks returns nothing but field names:

```
counts.runningContainers        ↔  containers.running
imageUsageCounts.totalImages    ↔  images.total
volumeUsageCounts.inuse         ↔  volumes.inUse
```

Two widgets showing one host's container stats is not a coincidence to be
tolerated — it is one card with two data sources.

**Fix.** `WidgetHostMetrics` in `shared/widget.tsx`, taking a shape neither API
uses verbatim:

```ts
type HostUsage = {
  containers: { running: number; stopped: number };
  images: { total: number; unused: number; size: number };
  volumes: { total: number; inUse: number; unused: number };
};
```

Each widget maps its own response into it in six lines, and the grid is written
once. **−28 lines, and the two cards can no longer disagree about what "Stopped"
looks like.**

Riding along: the footer chip list, `<ul className="flex flex-wrap gap-x-4 gap-y-1
text-sm">`, is character-identical at `arcane:84` and `docker:70`. `WidgetFooter`
already owns the title above it; let it own this layout too and both callers pass
bare `<li>`s.

## ✅ 2. `WidgetMetric` is handed pre-formatted numbers fifteen times

`integerFormatter.format(…)` appears at 15 call sites, every one of them feeding a
`value=` or a `detail=`. The component is the only consumer of the formatter, and
it does not use it.

**Fix.** One line in `WidgetMetric`:

```tsx
{
  typeof value === "number" ? integerFormatter.format(value) : value;
}
```

Ten of the fifteen calls go, along with the chance that the eleventh is forgotten
and a raw `4512` lands on the dashboard. The remaining five are inside `detail`
template strings and stay.

## ✅ 3. Two byte formatters for one idea

`formatGigabytes` has two call sites, both "total size of the images". `formatBytes`
has three, all added last week with the Backrest card. The second is a superset of
the first: in the GB range they print the same string, and outside it `formatBytes`
is the one that reads.

**Fix.** Delete `formatGigabytes`, point `arcane:72` and `docker:58` at
`formatBytes`. Its doc comment argues that GB is deliberate for Docker — it is not,
it is just what was needed the day it was written, and a host with 700 MB of images
reads better as `700 MB` than `0.7 GB`.

## ✅ 4. The trailing relative time, three times

`frigate/events.tsx:76`, `github/releases.tsx:37`, `backrest/summary.tsx:108`:

```tsx
<time dateTime={…} className="shrink-0 text-xs text-muted-foreground">
  {formatRelativeTime(…, now)}
</time>
```

Three copies, and three different routes to the millisecond — `start_time * 1_000`,
`new Date(iso).getTime()`, and a raw `number` — with `dateTime` filled from whatever
each widget happened to have. One of them passes the ISO string it was given, the
other two build a `Date` to call `toISOString()` on.

**Fix.** `WidgetTime` in `widget.tsx`, taking milliseconds and an optional `now`.
Five lines, three copies gone, and one answer to "how is a timestamp written here".

## ✅ 5. `length > 0 ? list : empty`, four times

`frigate:95`, `github:55`, `backrest:138`, `jellyfin/latest:98`. The same ternary
around the same two components, differing only in the sentence.

**Fix.** `WidgetList` takes an `empty` string and renders `WidgetEmptyState` when it
has no children — it already sits next to `WidgetMetadata`, which imports
`Children` for exactly this kind of inspection. Three lines in, four ternaries out.

```tsx
<WidgetList empty="No recent events.">{events.map(…)}</WidgetList>
```

## ✅ 6. A widget states its identity twice, and nothing checks it

`title`, `icon` and `className` are declared in the `defineWidget` call — where they
feed the skeleton and the error card — and again inside the `…Card` component, where
they feed the real thing. `skeleton: { withSubtitle: true }` is a third hand-kept
mirror of whether the header was given a `description`.

The tell is that every widget suite carries the same test, _"exposes a titled
skeleton through the widget definition"_. It exists because the two declarations can
disagree, and it is the only thing that notices when they do.

**Fix, without new machinery.** One object literal per widget file, read by both:

```tsx
const chrome = { title: "Backrest", icon: <IconSelfh name="backrest" />, className: "min-h-40" };
```

**Not recommended:** having `defineWidget` render the card shell and `render` return
only the content. It saves the same lines and rewrites all eight widgets to do it.

## 7. Noted, not worth touching

`target="_blank" rel="noreferrer"` plus an anchor class string appears in four files,
but the classes genuinely differ — `block truncate font-medium`, `group block`,
`font-medium text-destructive`. A shared `WidgetLink` would take as many props as it
removes.

---

## Deliberately left alone

- **`createFrigateClient` / `createArcaneClient` / `createBackrestClient`.** Three
  lines each around `serviceClient`. The wrapper _is_ the mutualisation; there is
  nothing left under it.
- **A generic "list widget".** The four lists differ in media, in layout and in what
  a row links to. Sharing the container (§5) is the part they have in common;
  sharing the rest would be inventing a shape none of them has.
- **`now?: number` defaulted to `Date.now()` per card.** Repeated in three widgets,
  but it is what lets each test pin the clock. Leave it.

## Total

Roughly **90 lines out** for **four small additions** to `shared/`
(`WidgetHostMetrics`, `WidgetTime`, `empty` on `WidgetList`, number handling in
`WidgetMetric`) and one deletion (`formatGigabytes`). Items 2 to 5 are each under
ten minutes and independent of one another; item 1 is the only one worth calling a
refactor.
