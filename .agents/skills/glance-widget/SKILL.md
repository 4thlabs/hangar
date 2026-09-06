---
name: glance-widget
description: Build a Glance dashboard widget for an HTTP/JSON API using the custom-api widget type. Use this whenever the user mentions Glance, glance.yml, community-widgets, a dashboard tile/widget/card for a self-hosted service (Arcane, Immich, Sonarr, Proxmox, Pi-hole, Uptime Kuma, Home Assistant...), or asks to "show X on my dashboard" / "add X to my dashboard" — even if they never say "custom-api". Covers picking endpoints, pinning JSON paths against a real response, the exact template function set Glance exposes, its utility CSS classes, and the community-widgets folder layout.
---

# Glance custom-api widgets

A Glance widget is a YAML block: one HTTP request plus a Go `html/template` that
renders the JSON into Glance's markup. No server, no extension, no dependency.
Everything below exists because the widget fails silently or renders garbage when
you get it wrong — a `custom-api` widget with a bad path shows an empty box, not
an error you can grep.

## What you deliver

The `glanceapp/community-widgets` layout — one directory per widget:

```
<widget-name>/
  README.md     the YAML in a ```yaml fence + an "Environment variables" section
  meta.yml      title / description / author
  preview.png   optional; say you can't produce one rather than faking it
```

The YAML lives **inside the README fence**, not in a sibling `.yml` — that's the
upstream convention. A separate `<name>.yml` is right only when the user is
wiring it into their own config via `$include:`; then note that `$include` needs
the whole config directory visible to Glance, not a single-file bind mount.

## Workflow

### 1. Find the smallest set of endpoints

Read the spec (`/openapi.json`, `/api/docs`, `/swagger.json`) or the project's API
docs. Prefer one endpoint that already aggregates — a `/dashboard`, `/stats`,
`/summary` route — over three calls stitched together. Each extra call is another
thing that can 401, time out, or change shape.

Need two calls anyway? Two options, in order of preference:
- **`group` widget** — children render as tabs, each with its own request. Best
  when the two views are independent (a summary and a list).
- **`subrequests:`** — runs concurrently, available as `(.Subrequest "key").JSON`.
  Use when both datasets belong in one view.
- `newRequest | getResponse` inside the template — only when the second URL
  depends on a value from the first response.

### 2. Pin every JSON path against a real response

This is the step that decides whether the widget works, and the one that is
easiest to skip. **A schema tells you what a field is called; it does not tell you
where the array lives.** The common trap: an API wraps most responses as
`{success, data: {...}}` but returns paginated lists as
`{success, data: [...], pagination: {...}}` — so `data.thing.count` is right on one
endpoint and `data.data` is wrong on the next. Reading the wrapper schema instead
of the specific response schema produces a widget that renders an empty list.

So, before writing the template:

```sh
curl -s -H "X-API-Key: $TOKEN" "$URL/api/whatever" | jq 'paths(scalars) | join(".")' | sort -u | head -40
```

That prints the literal dotted paths you can paste into `.JSON.String "..."`.
If the endpoint needs auth you don't have, resolve the *exact* response schema in
the spec (follow `$ref` on the 200 response, not the generic wrapper), then tell
the user plainly which paths are unverified and hand them a copy-pasteable curl
to check. Don't quietly present guessed paths as verified.

### 3. Write the widget

```yaml
- type: custom-api
  title: Immich
  title-url: ${IMMICH_URL}
  cache: 5m
  url: ${IMMICH_URL}/api/server/statistics
  headers:
    x-api-key: ${IMMICH_API_KEY}
  template: |
    <div class="flex justify-between text-center">
      <div>
        <div class="color-highlight size-h3">{{ .JSON.Int "photos" | formatNumber }}</div>
        <div class="size-h6">PHOTOS</div>
      </div>
    </div>
```

Rules that keep it working and reviewable:

- **Environment variables for every host and secret.** `${SERVICE_URL}` (no
  trailing slash) and `${SERVICE_TOKEN}`. Never a literal IP, hostname or key —
  the widget is meant to be copy-pasted by strangers. Query params go in
  `parameters:`, not glued onto the URL.
- **Cache honestly.** Minutes for a service on the same LAN (`5m`), hours for a
  public API that rarely changes (`6h`, `1d`). Every reload of every viewer hits
  this endpoint.
- **Filter server-side when the API can.** `parameters: {status: running}` beats
  ranging over 200 objects and skipping most of them — and it shrinks a response
  that may inline whole compose files or base64 blobs.
- **Guard optional fields** with `{{ if .Exists "updateInfo" }}` or a falsy check.
  A missing key yields the zero value, so a bare `{{ .String "x" }}` prints
  nothing and an `{{ if }}` on it is usually enough.
- **Long lists collapse**: `<ul class="list list-gap-10 collapsible-container"
  data-collapse-after="7">`.

See `references/template-functions.md` before writing any template logic — the
function set is fixed and small, and `default`, `lower`, `join`, `contains` and
the rest of the Sprig-flavoured helpers you may reach for **do not exist**.

### 4. Style with Glance's own classes

`references/css-classes.md` has the full list. Rules from the upstream
contributing guide, plus two of our own:

- Use utility classes (`flex`, `items-center`, `gap-10`, `grow`, `shrink-0`,
  `size-h3`, `text-truncate`, `color-subdue`) — they're stable API.
- Never reuse another widget's classes (`.twitch-category-thumbnail`); those get
  renamed. For anything the utilities don't cover, an inline `style=` is correct
  and expected.
- Never hardcode a color. `color-positive` / `color-negative` / `color-highlight`
  / `color-subdue`, or `var(--color-positive)` inside an inline style, so the
  widget follows the user's theme.
- Every `<a>` pointing at an external service gets `target="_blank"` — the
  dashboard stays open.
- Card grids (`cards-horizontal`) size columns from Glance's stylesheet. To make
  them narrower, set `style="width: 9rem; flex: 0 0 9rem;"` inline on each card
  (inline wins), exposed as a `card-width` option so it stays tunable.

### 5. Validate before you claim it works

```sh
curl -s "$URL/api/whatever" -H "X-API-Key: $TOKEN" > /tmp/sample.json
python3 scripts/lint_widget.py widget.yml --sample /tmp/sample.json
```

`lint_widget.py` (bundled, stdlib only, works on a `.yml` or a README fence)
catches exactly the failures that render as an empty box rather than an error:
template functions that don't exist, CSS classes that aren't in `utils.css`,
hardcoded colors, a missing `cache`, a literal key or IP in the config — and,
with `--sample`, every JSON path the template reads that isn't in the real
response, including paths inside `range` blocks. Run it with the sample whenever
you can reach the API; without one it still does everything else.

The other half is YAML shape: `template: |` must be a literal block scalar with
the whole template indented under it, and `{{ if }}`/`{{ end }}` must balance.

If the user has a running Glance and the credentials, the real check is a live
render; offer the throwaway config rather than assuming:

```sh
docker run --rm -p 8080:8080 -e SERVICE_URL=... -e SERVICE_TOKEN=... \
  -v $PWD/scratch.yml:/app/config/glance.yml glanceapp/glance
```

An empty widget body with no error banner means your paths are wrong, not that
the API is empty.

### 6. Write the README

Preview image (or a note that there isn't one), the YAML fence, then an
`## Environment variables` section listing each variable, what it is, and
*exactly* where the user clicks to get it — including which permissions or scopes
the token needs. Assume the reader has never opened this service's settings.

## Reference files

- `references/template-functions.md` — the complete function set, gjson path
  syntax, and the functions that don't exist. Read before writing template logic.
- `references/css-classes.md` — utility classes, theme colors, and the
  `data-popover-*` / `data-collapse-after` / relative-time attributes.
- `scripts/lint_widget.py` — the validator from step 5. Run it on anything you
  write before handing it over.
- `examples/arcane-dashboard.yml`, `arcane-containers.yml`,
  `arcane-projects.yml` — three widgets against a self-hosted Docker manager,
  written to be dropped into a `group` for tabs. Show a stat grid, a collapsible
  list with state-colored dots, icon fallbacks, popovers, and server-side
  filtering (`parameters: {status: running}`).
