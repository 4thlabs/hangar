# Fork patches (<FORK_OWNER>/<REPO> vs upstream <UPSTREAM_OWNER>/<REPO>)

This file tracks every change this fork carries on top of upstream that isn't
just a routine sync with `upstream/main`. Its job is to survive a "start over
from a fresh fork" scenario or make a future conflict easy to resolve — read it
before touching any file listed below during a sync, and update it whenever a
new fork-only patch lands or an old one gets upstreamed.

Remotes: `<FORK_REMOTE>` = the fork, `<UPSTREAM_REMOTE>` = upstream.

Last synced with upstream: <DATE>, `upstream/main` @ `<SHA>` (<VERSION>).
`<BRANCH>` is **rebased** on top of that commit — this fork keeps a linear
history and never merges upstream in, so the SHAs below change on every sync and
get refreshed here as part of it.

<!-- Environment notes go here: anything about how *this* deployment differs from
     a stock install, when a patch only exists because of it. Future-you will not
     remember, and it changes how a conflict should be resolved. -->

## Patches

### 1. <commit subject>

- Commit: `<sha>`
- Files: `<paths touched>`
- Problem: <what actually goes wrong upstream, concretely enough that someone
  can reproduce it — not "bug in X">
- Fix: <what the patch does, and why that approach over the alternatives>
- Upstream status: **not yet submitted** / PR #N open / merged upstream in
  <version> — drop this patch on the next sync.
