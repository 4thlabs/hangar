#!/usr/bin/env bash
# Report the shape of a fork: remotes, how the local branch sits against each of
# them, the newest upstream release tag, whether the history is linear, and
# whether the patched-release pipeline is already installed.
#
# Facts only, no guessing which remote is upstream — the naming is inconsistent
# across forks (4thlabs/arcane calls upstream "origin", 4thlabs/rawkoon calls it
# "upstream"), so read the URLs below and decide.
set -euo pipefail

cd "${1:?usage: fork_status.sh <repo-path>}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "repo:   $(basename "$PWD")   branch: $BRANCH"

echo
echo "remotes:"
git remote -v | grep '(fetch)' | sed 's/^/  /'

echo
for r in $(git remote); do
  head=$(git symbolic-ref -q "refs/remotes/$r/HEAD" 2>/dev/null || echo "refs/remotes/$r/main")
  head=${head#refs/remotes/}
  git rev-parse --verify -q "$head" >/dev/null || continue
  read -r behind ahead < <(git rev-list --left-right --count "$head...HEAD")
  echo "vs $head: HEAD is $ahead ahead, $behind behind"
  if [ "$ahead" -gt 0 ] && [ "$ahead" -le 40 ]; then
    git log --oneline --no-merges "$head..HEAD" | sed 's/^/    /'
    merges=$(git rev-list --merges --count "$head..HEAD")
    [ "$merges" -eq 0 ] || echo "    !! $merges merge commit(s) — history is not linear, rebase before releasing"
  fi
  echo
done

echo "newest release tags:"
git tag -l 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -3 | sed 's/^/  /' \
  || echo "  none matching ^v[0-9]+\.[0-9]+\.[0-9]+$ — check upstream's tag format"

echo
if [ -f .github/workflows/patched-release.yml ]; then
  echo "pipeline:  installed (.github/workflows/patched-release.yml)"
else
  echo "pipeline:  NOT installed — this fork needs setup"
fi
[ -f FORK_PATCHES.md ] && echo "patch log: FORK_PATCHES.md present" || echo "patch log: FORK_PATCHES.md missing"
