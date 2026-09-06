# Glance CSS reference

Utility classes from `internal/glance/static/css/utils.css`. These are stable
public API for widgets; per-widget classes (`.twitch-*`, `.markets-*`) are not —
never borrow them. Anything the utilities don't cover goes in an inline `style=`,
which the upstream contributing guide explicitly endorses.

## Text

`size-h1` `size-h2` `size-h3` `size-h4` `size-h5` `size-h6` `size-base`

h1 is ~1.7rem down to h6 ~1.1rem, base 1.3rem. The house style for a stat block
is a `size-h3` number over a `size-h6` label.

`text-left` `text-center` `text-right` · `text-truncate` `text-truncate-2-lines`
`text-truncate-3-lines` · `text-compact` `text-very-compact` `text-elevate` ·
`uppercase` `break-all` `visually-hidden`

`text-truncate` needs a `min-width-0` (flex) or `overflow-hidden` ancestor to
actually clip.

## Color

`color-highlight` (brightest text) · `color-paragraph` · `color-base` ·
`color-subdue` (dimmest) · `color-primary` · `color-positive` · `color-negative` ·
`color-primary-if-not-visited`

Variables for inline styles: `--color-primary` `--color-positive`
`--color-negative` `--color-highlight` `--color-text-base` `--color-text-subdue`
`--color-separator` `--color-widget-background` `--border-radius`.

**`--color-positive` defaults to `--color-primary`** — gold, not green — unless
the user set `positive-color` in their theme. Don't describe it as green, and
don't hardcode `#22c55e` to "fix" it; the point is that it follows the theme.

## Layout

`flex` `flex-column` `flex-wrap` `flex-nowrap` `flex-1` · `grow` `shrink`
`shrink-0` `min-width-0` `max-width-100` · `items-start` `items-center`
`items-end` · `justify-between` `justify-center` `justify-end` `justify-evenly`
`justify-stretch` · `self-center` · `block` `inline-block` `relative`
`overflow-hidden` `rounded`

`gap-5` `gap-7` `gap-10` `gap-12` `gap-15` `gap-20` `gap-25` `gap-35` `gap-45`
`gap-55` (those exact steps only — there is no `gap-8`)

`margin-top-{3,5,7,10,15,20,25,35,40,auto}` ·
`margin-bottom-{3,5,7,10,15,auto}` · `margin-block-{3,5,7,8,10,15}` ·
`margin-left-auto` · `padding-block-5` `padding-widget` `padding-block-widget`
`padding-inline-widget`

`cards-grid` `cards-horizontal` `cards-vertical` `card` `dynamic-columns`
`masonry` `carousel-container`

## Lists

`list` + `list-gap-{2,4,8,10,14,20,24,34}` — the standard vertical list.
`list-horizontal-text` — inline items separated by a bullet, for metadata rows.

Collapse a long list behind a "show more" button:

```html
<ul class="list list-gap-10 collapsible-container" data-collapse-after="7">
```

## Other components

`progress-bar` / `progress-value` · `thumbnail` `thumbnail-container` ·
`ui-icon` · `details` / `summary` · `hide-scrollbars` `select-none`
`pointer-events-none` `cursor-help`

## Data attributes

**Popover** (hover tooltip) on any element:

```html
<span data-popover-type="text" data-popover-text="12 unused · 4.2 GB">…</span>
```

Or richer markup with `data-popover-type="html"` and a child carrying
`data-popover-html` (that child is moved into the popover, so hide it with
`hidden` or CSS). Optional tuning: `data-popover-position` (`above`/`below`),
`data-popover-trigger="click"`, `data-popover-max-width`, `data-popover-margin`,
`data-popover-offset`, `data-popover-text-align`, `data-popover-show-delay`,
`data-popover-hide-delay`, `data-popover-anchor` (a selector).

**Relative time** — emit via `toRelativeTime` (see the template reference), which
produces `data-dynamic-relative-time="<unix>"` and updates client-side.

## Idioms

Header with logo, title and metadata:

```html
<div class="flex items-center gap-10">
  <img class="shrink-0" src="…" width="28" height="28" alt="" loading="lazy">
  <div class="grow min-width-0">
    <a class="size-h4 block text-truncate color-highlight" href="${URL}" target="_blank">Service</a>
    <ul class="list-horizontal-text">
      <li>v1.2.3</li>
      <li>12 items</li>
    </ul>
  </div>
</div>
```

Stat row:

```html
<div class="flex justify-between text-center">
  <div>
    <div class="color-highlight size-h3">{{ .JSON.Int "count" | formatNumber }}</div>
    <div class="size-h6">ITEMS</div>
  </div>
</div>
```

Status dot — color by state, from the theme:

```html
<span class="shrink-0" style="width:8px; height:8px; border-radius:50%;
  background-color:var(--color-{{ if eq $state "running" }}positive{{ else }}negative{{ end }});"></span>
```

Service icons: `https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/<name>.webp`
(Glance also accepts `si:`, `sh:` and `di:` prefixes in its own `icon:` fields,
but a `custom-api` template writes plain `<img src>`).
