---
name: branch-sync
description: Check, deep-preview, merge to main, and sync all git branches cleanly with zero conflicts. Use when checking branch status, previewing unmerged branches, merging feature branches into main, or updating all local/remote branches to match latest main safely.
---

# Branch Sync & Multi-Branch Management

Complete runbook and automation protocol to inspect all git branches, deep-preview branch changes, merge verified work into `main`, and synchronize all remaining active branches to the latest `main` state without creating merge conflicts or shredding uncommitted work.

## Core Protocols

### 1. Audit & Inventory (`check all branch`)
Before touching any branch, establish a complete snapshot of all local and remote branches:

```bash
# Fetch latest state from all remotes
git fetch --all --prune

# Audit local and tracking branches (ahead/behind main)
git for-each-ref --format='%(refname:short) | ahead: %(ahead-behind:main) | commit: %(subject) (%(authordate:relative))' refs/heads/
```

- Identify active feature branches vs stale/merged branches.
- Check working tree cleanliness (`git status --porcelain`). If uncommitted changes exist, stash or commit before proceeding.

### 2. Deep Preview (`preview sâu`)
Inspect any branch thoroughly before merging to ensure code quality and impact safety:

- **Diff Overview:** `git diff main...<branch>` (shows changes introduced by `<branch>`).
- **Commit History:** `git log main..<branch> --oneline --stat` (shows commit breakdown).
- **Symbol & Architecture Impact:**
  - Run `trail callers <symbol>` to check for breaking exported APIs across the branch boundary.
- **Dry-run Conflict Pre-check:**
  ```bash
  # Check if merging <branch> into main will cause conflicts BEFORE doing it
  git merge-tree $(git merge-base main <branch>) main <branch>
  ```
  If output contains `<<<<<<<`, conflicts will occur. Inspect conflicting files first.

### 3. Safe Merge to Main (`merge về main`)
Once a branch preview is validated and conflict-free:

1. Ensure main branch is up-to-date:
   ```bash
   git checkout main
   git pull --ff-only origin main
   ```
2. Merge the feature branch safely:
   ```bash
   # Prefer fast-forward if possible, otherwise clean merge
   git merge --no-ff <branch> -m "feat: merge <branch> into main"
   ```
3. Run verification (smoke test / `8sync doctor` / build):
   ```bash
   cargo build --release  # or project test command
   ```
4. Push updated main to remote:
   ```bash
   git push origin main
   ```

### 4. Zero-Conflict Multi-Branch Sync (`sync all branch`)
After `main` has advanced, synchronize all remaining active local/remote branches to match the latest `main`:

For each target branch `<branch>` (excluding `main`, `master`, or retired branches):

```bash
# 1. Checkout branch
git checkout <branch>

# 2. Dry-run conflict test with latest main
git merge-tree $(git merge-base main <branch>) <branch> main

# 3. If clean, merge main into branch
git merge main -m "sync: update <branch> with latest main"

# 4. Push updated branch to remote (if tracked)
git push origin <branch>
```

#### Safeguards & Conflict Prevention:
- **Uncommitted work on branch:** Auto-stash before checkout (`git stash save "branch-sync-autostash-<branch>"`), pop after sync (`git stash pop`).
- **Conflict detected during dry-run:** **NEVER force-merge or leave merge conflict markers.** Pause the sync for that specific branch, log the exact conflicting files, report to the user, and abort the merge for that branch (`git merge --abort`).
- **Return to original branch:** Always return the repository to the starting branch upon completion.

---

## Automation Script

Use the bundled script `assets/skills/branch-sync/scripts/branch_sync.py` (or run via Python/bash) for fast, multi-branch audit and conflict-free sync execution:

```bash
python3 ~/.omp/skills/branch-sync/scripts/branch_sync.py --action audit
python3 ~/.omp/skills/branch-sync/scripts/branch_sync.py --action preview --branch <branch>
python3 ~/.omp/skills/branch-sync/scripts/branch_sync.py --action merge --branch <branch>
python3 ~/.omp/skills/branch-sync/scripts/branch_sync.py --action sync-all
```
