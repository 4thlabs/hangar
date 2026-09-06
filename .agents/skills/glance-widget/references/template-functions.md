# Glance custom-api template reference

Go `html/template` with a fixed function map (source:
`internal/glance/widget-custom-api.go` + `templates.go`). Anything not listed here
does not exist and will fail the template at load time.

## Reading the JSON

The request's parsed body is `.JSON`. Accessors, each taking a gjson path:

| Call | Returns |
|---|---|
| `.JSON.String "key"` | string |
| `.JSON.Int "key"` | int |
| `.JSON.Float "key"` | float |
| `.JSON.Bool "key"` | bool |
| `.JSON.Array "key"` | `[]JSON` — range over it |
| `.JSON.Exists "key"` | bool |

A missing key returns the zero value, never an error. That's why a wrong path
renders an empty widget instead of failing loudly.

### Paths (gjson)

- Nested: `"user.address.city"`
- Index: `"users.0.name"`, `"names.0"`
- Whole document is an array: `.JSON.Array ""`, and inside, a scalar element is
  `.String ""`
- Query-ish selectors work too: `"..#.name"` (all `name` values), see
  [gjson docs](https://github.com/tidwall/gjson) for `#(...)` filters

### Inside `range`

`range` rebinds the context, so drop `.JSON`:

```
{{ range .JSON.Array "posts" }}
  <div>{{ .String "title" }}</div>   {{/* not .JSON.String */}}
  <div>{{ $.JSON.String "author" }}</div>  {{/* $ = top level */}}
{{ end }}
```

## Other request data

- `.Response.StatusCode`, `.Response.Status`, `.Response.Header.Get "Content-Type"`
- `.Subrequest "name"` → same shape (`.JSON`, `.Response`) for a `subrequests:` entry
- `.Options.StringOr "key" "fallback"`, `.IntOr`, `.FloatOr`, `.BoolOr`, `.JSON`
  — reads the widget's `options:` map, so users can tweak a widget without
  editing its template
- `.JSONLines` — for ndjson, with `skip-json-validation: true`

## Functions

**Numbers** — `add` `sub` `mul` `div` `mod`, `toFloat` `toInt`, `absInt`,
`percentChange`, `formatNumber` (1000 → 1,000), `formatApproxNumber` (1000 → 1k),
`formatPrice`, `formatPriceWithPrecision`.

`div` of two ints returns an int. For bytes → GB do
`div (.JSON.Int "bytes" | toFloat) 1073741824 | printf "%.1f"`. Division by zero
returns 0; non-numeric returns NaN.

**Strings** — `trimPrefix` `trimSuffix` `trimSpace`, `replaceAll`,
`replaceMatches` (regex), `findMatch` (regex), `findSubmatch`, `concat`.

Argument order is prefix-first for piping: `trimPrefix "/" $name`,
`replaceAll "_" " " $kind`.

**Time** — `now`, `offsetNow "-24h"`, `duration "1h"`, `parseTime layout s`,
`parseLocalTime`, `formatTime layout t`, `parseRelativeTime layout s`,
`toRelativeTime t`, `startOfDay`, `endOfDay`.

Layouts: `"unix"`, `"RFC3339"`, `"RFC3339Nano"`, `"DateTime"`, `"DateOnly"`,
`"TimeOnly"`, or a Go layout string.

`toRelativeTime` returns an **HTML attribute**, so it must sit inside a tag, not
in text — Glance ticks it client-side:

```
<span {{ .String "created" | parseTime "rfc3339" | toRelativeTime }}></span>
```

**Arrays** — `sortByString key order arr`, `sortByInt`, `sortByFloat`,
`sortByTime key layout order arr`, `unique key arr`. `order` is `"asc"`/`"desc"`.

**Extra requests** — `newRequest url`, then pipe through `withHeader k v`,
`withParameter k v`, `withStringBody`, `withAllowInsecure`, ending in
`getResponse`. Check `.Response.StatusCode` yourself; Glance won't.

**Escaping** — `safeHTML`, `safeCSS`, `safeURL`. Only for markup you control;
piping API-controlled strings through `safeHTML` is an injection into the user's
dashboard.

**Go builtins** — `eq` `ne` `lt` `le` `gt` `ge`, `and` `or` `not`, `index`, `len`,
`printf`, `slice`, `print`, `println`, `urlquery`, plus `if/else/range/with/define/template`
and `$var :=` assignment.

## Functions that do NOT exist

Reaching for these is the most common template failure. There is no `default`,
`lower`, `upper`, `title`, `join`, `split`, `contains`, `hasPrefix`, `hasSuffix`,
`ternary`, `dict`, `list`, `first`, `last`, `date`, `now | date` — no Sprig at all.

Workarounds:

| You want | Use |
|---|---|
| `default "n/a" $x` | `{{ if $x }}{{ $x }}{{ else }}n/a{{ end }}` |
| `contains "x" $s` | `{{ if findMatch "x" $s }}` |
| `hasPrefix "/" $s` | `{{ if ne $s (trimPrefix "/" $s) }}` |
| `join ", " $arr` | range with a `{{ if $i }}, {{ end }}` separator |
| fallback chain | `{{ $v := .String "a" }}{{ if not $v }}{{ $v = .String "b" }}{{ end }}` |

Note `=` (reassign) vs `:=` (declare) — reassigning inside an `if` needs `=`, and
Go templates scope `:=` to the block, which silently loses the value.
