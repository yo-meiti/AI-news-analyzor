#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/clean_git_history.sh <git-remote-url>
# Example: ./scripts/clean_git_history.sh https://github.com/yo-meiti/AI-news-analyzor
# This script creates a mirror clone, runs git-filter-repo to replace/remove
# sensitive strings and files, and then force-pushes the cleaned history.
# REVIEW the replacements file before running. This operation is destructive.

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <git-remote-url>" >&2
  exit 2
fi

REPO_URL="$1"
TMPDIR="/tmp/ai-news-analyzor-filtered-$$"

command -v git >/dev/null 2>&1 || { echo "git not found" >&2; exit 1; }
command -v git-filter-repo >/dev/null 2>&1 || {
  echo "git-filter-repo not found. Install it first: https://github.com/newren/git-filter-repo" >&2
  exit 1
}

echo "Cloning mirror into $TMPDIR..."
git clone --mirror "$REPO_URL" "$TMPDIR"
cd "$TMPDIR"

if [ ! -f ../replacements.txt ]; then
  echo "Creating example replacements file at ../replacements.txt (edit before running)"
  cat > ../replacements.txt <<'EOF'
# Replace exact literals with a safe placeholder. Lines starting with # are comments.
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==>REDACTED_TAVILY_KEY
0b040ef6f3ebaacebc19f587b29d002612aa6a59d0b578c2==>REDACTED_NOTIFY_TOKEN
workerbridge-notify-v1==>REDACTED_NOTIFY_VAR
1ea6afa7ec19bae978a5edcf917000928ccf21d099d424de7db109e488606726==>REDACTED_NOTIFY_TOKEN
EOF
fi

echo "Make sure replacements file is reviewed: $(realpath ../replacements.txt)"
read -p "Ready to proceed with rewrite? (type YES to continue) " confirm
if [ "$confirm" != "YES" ]; then
  echo "Aborting."; exit 1
fi

echo "Running git-filter-repo replace-text..."
git filter-repo --replace-text ../replacements.txt --force

echo "Optionally remove sensitive files from history. Review and edit the paths below if needed."
SENSITIVE_PATHS=("llm-chat-app-template/CF Flux2 -_ Telegram.fixed.json")
for p in "${SENSITIVE_PATHS[@]}"; do
  if git rev-list --all --quiet -- "$p"; then
    echo "Removing path from history: $p"
    git filter-repo --invert-paths --paths "$p" --force
  else
    echo "Path not present in history: $p"
  fi
done

echo "Pushing cleaned history back to origin (force)."
read -p "FINAL CONFIRM: force-push cleaned history to origin? This will rewrite remote history. Type PUSH to continue: " pushc
if [ "$pushc" != "PUSH" ]; then
  echo "Skipping push. Cleaned repo is at: $TMPDIR"; exit 0
fi

git remote set-url origin "$REPO_URL"
git push --force --all
git push --force --tags

echo "Done. Cleaned history pushed. Local mirror at: $TMPDIR"
