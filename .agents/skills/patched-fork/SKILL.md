---
name: patched-fork
description: Publish a container image that is "upstream's newest release + this fork's own patches", and re-sync that fork when upstream ships a new version. Covers the patched-release GitHub Actions workflow, the rebase-onto-upstream sync, FORK_PATCHES.md bookkeeping, and the -patched/+patched version convention. Use this whenever the user mentions a fork of an upstream project, a patched image on ghcr.io, rebasing or syncing a fork onto upstream, cherry-picking fork patches onto a release tag, or asks to do "the same thing we did for arcane / rawkoon" with another repo — even when they only say "rebase my fork", "build an image for my fork", or "upstream released a new version".
---

# Patched fork releases

You keep a fork of an upstream project because you carry a small number of patches
upstream hasn't merged. You need a container image that is **upstream's latest
release tag plus exactly those patches**, published under your own namespace, and
you need to refresh it when upstream cuts a new tag.

Two reference implementations already run this way: `4thlabs/arcane` (fork of
`getarcaneapp/arcane`, consumed by `store/arcane/compose.yml`) and
`4thlabs/rawkoon` (fork of `samuelloranger/rawkoon`, consumed by
`store/rawkoon/compose.yml`). Read either `.github/workflows/patched-release.yml`
when you want a concrete example rather than the template.

## Start here

Fork repos live outside this homelab checkout — drive git with an explicit path,
never assume the working directory. First, learn the shape of the repo:

```bash
.claude/skills/patched-fork/scripts/fork_status.sh ~/Code/<repo>
```

It reports the remotes and their URLs, how the local branch sits against each
remote, the newest upstream release tag, whether the history is linear, and
whether the pipeline is already installed. Everything below branches on that.

- Pipeline **not** installed → [Setting up a fork](#setting-up-a-fork)
- Pipeline installed, upstream has moved → [Syncing onto new upstream](#syncing-onto-new-upstream)

## The five invariants

These are the load-bearing decisions. Understanding *why* they hold matters more
than copying the YAML, because every fork's build steps differ.

**1. The fork's default branch is rebased onto upstream, never merged.**
The whole pipeline defines "the patch set" as `upstream/main..HEAD`. That
expression is only meaningful on a linear history — one merge of upstream into
the fork and the list fills with hundreds of upstream commits, and the build
tries to cherry-pick them onto a tag they're already in. Rebasing is what keeps
the patch set legible; the cost is a force-push on every sync, which is fine on a
fork nobody else branches from.

**2. The image is built from the release *tag*, not from the fork's branch.**
The workflow checks out `patched/vX.Y.Z` starting at the upstream tag, then
cherry-picks the patches onto it. Building the fork's branch directly would ship
whatever landed on `upstream/main` after the tag — an untested mix that is
neither the release nor the fork.

**3. Fork-only scaffolding is excluded from the cherry-pick.**
`.github/` (the patched-release workflow itself) and `FORK_PATCHES.md` exist to
run and document the fork; they have no business inside the released image, and
CI files conflict with upstream's own. The workflow filters them out by touched
path, so adding a new patch needs no change to the filter — commits that touch
*only* scaffolding are skipped, commits that touch real code are kept.

**4. Docker tag `-patched`, application version `+patched`.**
Docker tags forbid `+`, so the image must be `<x.y.z>-patched`. But if the app
reports its own version and compares it against upstream's releases (Arcane does
this), `-patched` reads as a semver **pre-release** — i.e. *older* than `x.y.z` —
and the update checker offers a downgrade to the very release you patched.
`+patched` is build metadata, which semver comparison ignores, so genuine
upstream releases still surface as updates. Pass `+patched` to whatever build-arg
carries the app version, and keep `-patched` only in the tag.

**5. The build and test steps are stolen from upstream's own release workflow.**
Do not invent a build. Open upstream's release/publish workflow and copy its
setup actions, Dockerfile path, platforms, and build args verbatim; the only
things you change are where the source comes from and what the image is tagged.
When you diverge — Arcane drops to `linux/amd64` because upstream builds
multi-arch on Depot runners you don't have — say so in a comment, since the next
person will wonder.

## Setting up a fork

1. **Confirm the remotes.** One points at the fork, one at upstream. Naming is
   not a convention you can rely on: arcane calls upstream `origin` and the fork
   `fork`; rawkoon does the opposite. Read the URLs, don't guess from the name.

2. **Make the history linear.** If `fork_status.sh` reports merge commits between
   upstream and HEAD, rebase before anything else (see the sync section) — the
   patch set is undefined until then.

3. **Read upstream's release workflow** and note: the setup actions, the
   Dockerfile path and context, the test command, the build args, the platforms,
   and the image name. This is the raw material for the next step.

4. **Write `.github/workflows/patched-release.yml`.** Start from
   `assets/patched-release.yml` in this skill and fill in the marked
   placeholders. Keep `workflow_dispatch` as the only trigger: upstream tags
   arrive on their schedule, not yours, and you want to decide when to rebuild.
   The workflow file must sit on the fork's **default branch** — GitHub only
   lists `workflow_dispatch` workflows from there, so a `develop`-only pipeline
   is invisible in the Actions UI.

5. **Write `FORK_PATCHES.md`.** Start from `assets/FORK_PATCHES.md`. One section
   per patch: commit SHA, files, the problem, the fix, and whether it's been sent
   upstream. This is the file that makes a conflicted rebase resolvable six
   months later, and the one that tells you when a patch can finally be dropped.

6. **Dispatch the workflow** and check the image lands. The run should print the
   patches it applied — read that list and make sure it is exactly your patch
   set, no more.

7. **Point the compose file at it.** In `store/<app>/compose.yml`, replace the
   upstream image with `ghcr.io/<owner>/<name>:<moving-tag>` and leave the
   upstream line commented above it, the way both existing forks do — it
   documents what you forked from and makes reverting a one-line edit.

## Syncing onto new upstream

Run this when upstream cuts a release you want. The goal is: the fork's patches
sit on top of the newest upstream commit, cleanly, and a fresh image is built.

```bash
cd ~/Code/<repo>
git fetch <upstream-remote> --tags --prune
git branch -f backup/<branch>-pre-rebase <branch>     # cheap insurance, costs nothing
git rebase <upstream-remote>/main
```

The backup branch is not ceremony: a rebase that goes wrong plus a force-push
loses the patch set entirely, and the branch is a zero-cost pointer you can
delete once the image builds.

**When a patch conflicts**, read its section in `FORK_PATCHES.md` before touching
the diff — it records what the patch was working around, which is usually the
thing that decides how to resolve. Two outcomes worth watching for:

- Upstream fixed the same bug themselves → the patch is obsolete. Drop the commit
  (`git rebase --skip`) and delete its section from `FORK_PATCHES.md` with a note
  in the sync commit saying it was upstreamed. Carrying a redundant patch is how
  forks rot.
- Upstream restructured the code the patch touches → reapply the *intent*, not
  the diff. The FORK_PATCHES entry describes the intent; that's what it's for.

Then finish:

```bash
git push -f <fork-remote> <branch>
```

Refresh `FORK_PATCHES.md` in the same push — the "last synced with upstream"
line, the new commit SHAs (rebasing changes every one of them), and any patch
you dropped. Stale SHAs in that file are worse than none, because they send the
next reader to a commit that no longer exists.

Finally dispatch the patched-release workflow and confirm the image is published.
Leave the homelab compose file alone unless the moving tag changed — pinning to
`:patched` or `:latest` means a `docker compose pull` is all that's needed.

## Verifying a run

The workflow can succeed and still ship the wrong thing. Two checks catch it:

- The "applying:" line in the log lists exactly the fork's patches. Too many
  means the history stopped being linear; too few means the path filter ate a
  real patch.
- The published tag is `<newest-upstream-version>-patched`. If it's an older
  version, the tag fetch pattern missed upstream's newest release — check whether
  upstream changed its tag format (`v1.2.3` vs `1.2.3` vs `app-v1.2.3`).

## Reference

- `assets/patched-release.yml` — the workflow template, with the fork-specific
  parts marked.
- `assets/FORK_PATCHES.md` — the patch-log template.
- `scripts/fork_status.sh` — the repo-shape report described above.
