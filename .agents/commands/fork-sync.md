---
description: Rebase a patched fork onto the newest upstream and rebuild its image
argument-hint: <repo-path-or-name> (e.g. rawkoon, ~/Code/arcane)
---

Sync the fork at `$1` onto upstream's newest release and publish a fresh patched
image. Resolve a bare name against `~/Code/<name>`.

Use the `patched-fork` skill — it holds the invariants this depends on. Then work
through its "Syncing onto new upstream" section:

1. Run the skill's `fork_status.sh` on the repo. Stop and report if the working
   tree is dirty, the pipeline isn't installed, or the history isn't linear —
   each needs a decision, not a guess.
2. Fetch upstream, cut the backup branch, rebase.
3. On a conflict, read the patch's entry in `FORK_PATCHES.md` before resolving.
   If upstream has fixed the same thing, drop the patch rather than forcing it
   through, and say so.
4. Refresh `FORK_PATCHES.md`: sync date, upstream SHA and version, the new commit
   SHAs, and any patch that got dropped. Commit that on its own.
5. Force-push the branch to the fork remote, then dispatch the patched-release
   workflow and report the tag it published.

Leave this homelab repo untouched — the compose files pin a moving tag, so a
`docker compose pull` picks the new image up. Mention the tag so I can decide.

Report at the end: patches carried, patches dropped, the upstream version synced
to, and the image tag published.
