#!/usr/bin/env python3
"""Lint a Glance custom-api widget.

    python3 lint_widget.py widget.yml [--sample response.json]

Checks the things that fail silently at render time: YAML validity, template
functions that don't exist in Glance's func map, CSS classes that aren't in
utils.css, hardcoded colors, missing cache, secrets baked into the file. With
--sample (a real response body, e.g. `curl ... > response.json`) it also
verifies every JSON path the template reads actually exists in that response --
the single most common reason a widget renders an empty box.

Exits non-zero if anything is wrong. Works on a .yml or on a README.md with a
```yaml fence.
"""
import json, re, sys, pathlib

FUNCS = set("""
toFloat toInt add sub mul div mod now offsetNow duration parseTime formatTime
parseLocalTime toRelativeTime parseRelativeTime startOfDay endOfDay trimPrefix
trimSuffix trimSpace replaceAll replaceMatches findMatch findSubmatch
percentChange sortByString sortByInt sortByFloat sortByTime concat unique
newRequest withHeader withParameter withStringBody withAllowInsecure getResponse
formatApproxNumber formatNumber safeCSS safeURL safeHTML absInt formatPrice
formatPriceWithPrecision dynamicRelativeTimeAttrs formatServerMegabytes
and or not eq ne lt le gt ge index len printf slice print println urlquery call html js
if else end range with define template block break continue nil true false
""".split())

CLASSES = set("""
attachments block break-all card cards-grid cards-horizontal cards-vertical
carousel-container collapsible-container collapsible-item color-base
color-highlight color-negative color-paragraph color-positive color-primary
color-primary-if-not-visited color-subdue cursor-help details dynamic-columns
flex flex-1 flex-column flex-nowrap flex-wrap gap-10 gap-12 gap-15 gap-20 gap-25
gap-35 gap-45 gap-5 gap-55 gap-7 grow hide-scrollbars inline-block items-center
items-end items-start justify-between justify-center justify-end justify-evenly
justify-stretch list list-gap-10 list-gap-14 list-gap-2 list-gap-20 list-gap-24
list-gap-34 list-gap-4 list-gap-8 list-horizontal-text list-with-transition
margin-block-10 margin-block-15 margin-block-3 margin-block-5 margin-block-7
margin-block-8 margin-bottom-10 margin-bottom-15 margin-bottom-3 margin-bottom-5
margin-bottom-7 margin-bottom-auto margin-bottom-widget margin-left-auto
margin-top-10 margin-top-15 margin-top-20 margin-top-25 margin-top-3
margin-top-35 margin-top-40 margin-top-5 margin-top-7 margin-top-auto masonry
masonry-column max-width-100 min-width-0 overflow-hidden padding-block-5
padding-block-widget padding-inline-widget padding-widget pointer-events-none
progress-bar progress-bar-combined progress-value progress-value-notice relative
rounded rtl scale-half select-none self-center shrink shrink-0 single-line-titles
size-base size-h1 size-h2 size-h3 size-h4 size-h5 size-h6 summary text-center
text-compact text-elevate text-left text-right text-truncate text-truncate-2-lines
text-truncate-3-lines text-very-compact thumbnail thumbnail-container ui-icon
uppercase value-separator visited-indicator visually-hidden widget-content
""".split())

ACTION = re.compile(r"\{\{-?(.*?)-?\}\}", re.S)
STRING = re.compile(r'"(?:[^"\\]|\\.)*"')
IDENT = re.compile(r"(?<![.$\w])[A-Za-z_]\w*")
ACCESS = re.compile(r'\.(String|Int|Float|Bool|Array|Exists)\s+"([^"]*)"')
RANGE = re.compile(r'range\s+(?:\$\w+\s*(?:,\s*\$\w+\s*)?:=\s*)?\.(?:JSON\.)?Array\s+"([^"]*)"')

def load(path):
    """Return (list of widget blocks, error). A widget block is (raw_yaml, template)."""
    text = pathlib.Path(path).read_text()
    if path.endswith((".md", ".markdown")):
        fences = re.findall(r"```ya?ml\n(.*?)```", text, re.S)
        if not fences:
            return None, "no ```yaml fence found in the markdown"
        text = "\n".join(fences)
    try:
        import yaml
        try:
            list(yaml.safe_load_all(text))
        except Exception as e:
            return None, f"YAML does not parse: {e}"
    except ImportError:
        pass  # no pyyaml: skip the parse check, the block scan below still works
    lines = text.split("\n")
    starts = [i for i, l in enumerate(lines) if re.match(r"\s*-\s+type:", l)]
    blocks = []
    for n, i in enumerate(starts):
        j = starts[n + 1] if n + 1 < len(starts) else len(lines)
        blocks.append("\n".join(lines[i:j]))
    return blocks, None

def template_of(block):
    lines = block.split("\n")
    for i, l in enumerate(lines):
        m = re.match(r"(\s*)template:\s*\|", l)
        if not m:
            continue
        indent = len(m.group(1))
        body = []
        for l2 in lines[i + 1:]:
            if l2.strip() and len(l2) - len(l2.lstrip()) <= indent:
                break
            body.append(l2)
        return "\n".join(body)
    return ""

def gjson(obj, path):
    """Minimal gjson: dotted keys and numeric indexes. Returns (found, value)."""
    cur = obj
    if path == "":
        return True, cur
    for part in path.split("."):
        if isinstance(cur, list):
            if not part.isdigit() or int(part) >= len(cur):
                return False, None
            cur = cur[int(part)]
        elif isinstance(cur, dict):
            if part not in cur:
                return False, None
            cur = cur[part]
        else:
            return False, None
    return True, cur

def check_paths(tpl, sample, err):
    """Walk the template tracking block nesting, and resolve every accessor
    against the sample. Only `range` changes the context; if/with do not, but
    they do consume an `end` -- getting that wrong is what makes a naive checker
    report every field inside a loop as missing."""
    frames = []  # ("range", path, value) | ("other",)

    def scope():
        for f in reversed(frames):
            if f[0] == "range":
                return f[1], f[2]
        return "", sample

    external = set()  # vars bound to a subrequest / newRequest: different response body

    for m in ACTION.finditer(tpl):
        body = m.group(1).strip()
        prefix, base = scope()
        rooted = ".JSON." in body
        if "Subrequest" in body or "getResponse" in body:
            external.update(re.findall(r"\$(\w+)\s*:?=", body))
            continue
        if any(re.search(r"\$" + v + r"\b", body) for v in external):
            continue  # reads a different response than --sample
        for kind, path in ACCESS.findall(body):
            target = sample if rooted else base
            if target is None:
                continue
            if not gjson(target, path)[0]:
                err(f'path not found in sample response: .{kind} "{path}" '
                    f'(relative to {"<root>" if rooted or not prefix else prefix + "[]"})')
        kw = body.split()[0] if body.split() else ""
        r = RANGE.search(body)
        if r:
            target = sample if rooted else base
            ok, val = gjson(target, r.group(1)) if target is not None else (False, None)
            if ok and not isinstance(val, list):
                err(f'range target "{r.group(1)}" is not an array in the sample response')
                ok = False
            frames.append(("range", r.group(1), (val[0] if val else None) if ok else None))
        elif kw in ("if", "with", "block", "define", "range"):
            frames.append(("other",))
        elif kw == "end" and frames:
            frames.pop()

def main():
    argv = sys.argv[1:]
    sample, args = None, []
    while argv:
        a = argv.pop(0)
        if a == "--sample":
            sample = json.loads(pathlib.Path(argv.pop(0)).read_text())
        elif not a.startswith("--"):
            args.append(a)
    if not args:
        print(__doc__)
        return 2
    problems = []
    for path in args:
        def err(msg, path=path):
            problems.append(f"{path}: {msg}")
        blocks, e = load(path)
        if e:
            err(e)
            continue
        found = False
        for w in blocks or []:
            if not re.search(r"type:\s*custom-api", w):
                continue
            found = True
            tpl = template_of(w)
            if not tpl:
                err("custom-api widget has no template")
            if not re.search(r"^\s*cache:", w, re.M):
                err("no cache set - every page load will hit the API")
            for m in ACTION.finditer(tpl):
                body = m.group(1)
                if body.lstrip().startswith("/*"):
                    continue  # {{/* template comment */}}
                body = STRING.sub('""', body)
                for ident in IDENT.findall(body):
                    if ident not in FUNCS:
                        err(f'unknown template function "{ident}" - not in Glance\'s func map')
            for cls in re.findall(r'class="([^"{}]*)"', tpl):
                for c in cls.split():
                    if c not in CLASSES:
                        err(f'CSS class "{c}" is not a Glance utility class - if it belongs to '
                            f'another widget it will break when that widget is restyled; '
                            f'use a utility class or an inline style')
            for color in re.findall(r"(?:#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\))", tpl):
                err(f"hardcoded color {color} - use color-* classes or var(--color-*)")
            blob = w
            for secret in re.findall(r"\b[A-Fa-f0-9]{32,}\b", blob):
                err(f"looks like a literal API key in the config: {secret[:6]}...")
            for ip in re.findall(r"https?://(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?", blob):
                err(f"hardcoded address {ip} - use an ${{ENV_VAR}} instead")
            if sample is not None:
                check_paths(tpl, sample, err)
        if not found:
            err("no custom-api widget found")
    for p in problems:
        print("FAIL " + p)
    print(("FAILED: %d problem(s)" % len(problems)) if problems else "OK")
    return 1 if problems else 0

if __name__ == "__main__":
    sys.exit(main())
