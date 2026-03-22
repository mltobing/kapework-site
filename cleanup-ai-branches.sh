#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-/home/user/kapework-site}"
REMOTE="${REMOTE:-origin}"
BASE="${BASE:-main}"
MODE="${MODE:-preview}"

# Branch prefixes to treat as AI-generated.
# Add more here if needed, e.g. chatgpt|openai
PREFIX_REGEX="${PREFIX_REGEX:-^(origin/)?(claude|codex)/}"

if [[ ! -d "$REPO/.git" ]]; then
  echo "Repo not found at: $REPO"
  exit 1
fi

cd "$REPO"

echo "==> Syncing repo"
git fetch "$REMOTE" --prune
git checkout "$BASE"
git pull --ff-only "$REMOTE" "$BASE"
git fetch "$REMOTE" --prune

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

HAS_GH=0
if command -v gh >/dev/null 2>&1; then
  HAS_GH=1
  gh pr list --repo "$(git remote get-url "$REMOTE" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')" \
    --state open \
    --limit 200 \
    --json headRefName \
    --jq '.[].headRefName' \
    | sort -u > "$tmp/open_prs.txt" || true
else
  : > "$tmp/open_prs.txt"
fi

git branch -r --merged "$REMOTE/$BASE" \
  | sed 's/^[ *]*//' \
  | grep -E "$PREFIX_REGEX" \
  | sed "s#^$REMOTE/##" \
  | sort -u > "$tmp/merged_ai.txt" || true

if [[ -s "$tmp/open_prs.txt" ]]; then
  grep -vxFf "$tmp/open_prs.txt" "$tmp/merged_ai.txt" > "$tmp/delete_candidates.txt" || true
else
  cp "$tmp/merged_ai.txt" "$tmp/delete_candidates.txt"
fi

echo
echo "=== OPEN PR BRANCHES (protected) ==="
if [[ -s "$tmp/open_prs.txt" ]]; then
  cat "$tmp/open_prs.txt"
else
  if [[ "$HAS_GH" -eq 1 ]]; then
    echo "(none)"
  else
    echo "(gh not installed; could not check open PR branches)"
  fi
fi

echo
echo "=== MERGED AI/CODEX BRANCHES FOUND ==="
if [[ -s "$tmp/merged_ai.txt" ]]; then
  nl -ba "$tmp/merged_ai.txt"
else
  echo "(none)"
fi

echo
echo "=== DELETE CANDIDATES ==="
echo "(merged into $REMOTE/$BASE and not tied to an open PR)"
if [[ -s "$tmp/delete_candidates.txt" ]]; then
  nl -ba "$tmp/delete_candidates.txt"
else
  echo "(none)"
fi

if [[ "$MODE" == "delete" ]]; then
  if [[ "$HAS_GH" -ne 1 ]]; then
    echo
    echo "Refusing delete mode because gh is not installed, so open PR branches cannot be protected."
    exit 1
  fi

  if [[ ! -s "$tmp/delete_candidates.txt" ]]; then
    echo
    echo "Nothing to delete."
  else
    echo
    echo "==> Deleting remote branches"
    while read -r b; do
      [[ -n "$b" ]] || continue
      echo "Deleting $REMOTE/$b"
      git push "$REMOTE" --delete "$b"
    done < "$tmp/delete_candidates.txt"
    git fetch "$REMOTE" --prune
  fi
fi

echo
echo "=== REMAINING AI/CODEX REMOTE BRANCHES BY RECENCY ==="
while read -r ref; do
  branch="${ref#${REMOTE}/}"
  date="$(git log -1 --format=%cs "$ref" 2>/dev/null || echo unknown)"
  marker=""
  if [[ -s "$tmp/open_prs.txt" ]] && grep -qxF "$branch" "$tmp/open_prs.txt"; then
    marker="  [OPEN PR]"
  fi
  printf "%s  %s%s\n" "$date" "$branch" "$marker"
done < <(
  git for-each-ref --sort=-committerdate --format='%(refname:short)' "refs/remotes/$REMOTE" \
  | grep -E "$PREFIX_REGEX" || true
)

echo
if [[ "$MODE" != "delete" ]]; then
  echo "Preview only."
  echo "When the delete list looks right, run:"
  echo "  MODE=delete ./cleanup-ai-branches.sh"
fi
