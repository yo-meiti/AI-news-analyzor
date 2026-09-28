Cleaning git history (instructions)

1. Review `scripts/replacements.txt` and add any additional literals you want removed or replaced.

2. Make the cleanup script executable:

```bash
chmod +x scripts/clean_git_history.sh
```

3. Run the script against your remote (it will clone a mirror and perform the rewrite):

```bash
./scripts/clean_git_history.sh https://github.com/yo-meiti/AI-news-analyzor
```

4. When prompted, confirm by typing `YES`, then type `PUSH` to force-push cleaned history.

Notes:
- This operation rewrites history and force-pushes — coordinate with collaborators before running.
- If you prefer BFG Repo-Cleaner, the task can be adapted.
