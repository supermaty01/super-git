# SuperGit

A lightweight, local-only desktop Git client for Windows, centred on a fast, readable branch graph. Everything runs on your machine through the git CLI: no account, no cloud service and no AI features.

## Features

| Area | What you get |
| --- | --- |
| **Branch visualizer** | Commit graph with lanes, merge curves, avatars, ref labels (local / remote / tag, `+N` overflow; hover a label to list every ref on that commit and highlight the branch's history; ahead / behind counts on hover), WIP and stash nodes, date markers, multi-select, search (Ctrl+F). Drag a branch onto another to merge, rebase or push. Hide, solo or pin a branch to the left lane; Smart Branch Visibility; compact graph. Toggle remotes, tags and stashes. Optional Author, Date, SHA and Changes columns (right-click the graph header or use its gear) |
| **Git actions** | Commit / amend (skip hooks, sign), stage / unstage / discard by file, hunk or single line. Branch create / checkout / rename / delete / upstream / fast-forward. Merge (ff, no-ff, squash), rebase, interactive rebase (pick / reword / edit / squash / fixup / drop / reorder), cherry pick, revert, reset soft / mixed / hard. Tags, stash (all / staged only / keep index, rename, apply / pop / delete), worktrees, remotes, submodules (add / init / update / sync / open). Fetch / pull (ff, ff-only, rebase) / push (set upstream, force-with-lease), undo / redo |
| **Gitflow** | Initialize, then start and finish features, releases and hotfixes. Implemented with plain git commands, so no extra tools are needed |
| **Git LFS** | Initialize, track / untrack patterns; toolbar LFS menu to fetch / checkout / pull / push / prune all LFS files |
| **Patches** | Create a patch from one or more commits; apply a patch as commits (`git am`) or to the working directory |
| **History** | Commit details (+/− per file, signature status, "View all files"), compare two commits or a commit against the working directory, file history, blame, fuzzy file finder (Ctrl+P) |
| **Diffs** | Hunk, Inline and Split views (Monaco), side-by-side image diffs, File View with "Edit this file", external diff tool |
| **Conflict resolver** | 3-pane A / B / Output merge tool with per-line checkboxes, conflict navigation, take ours / theirs, external merge tool, and continue / skip / abort for merges, rebases, cherry picks, reverts and patches |
| **Integrations** | GitHub, GitLab, Bitbucket, Azure DevOps, GitHub Enterprise, GitLab Self-Managed and Bitbucket Data Center. "Connect" uses the browser sign-in of Git Credential Manager (bundled with Git for Windows), so there is no SuperGit server; a personal access token works too (stored encrypted with Windows DPAPI). Browse and clone your repositories (HTTPS or SSH); git operations use the same account |
| **Interface** | Native context menus with submenus; inline toolbar prompts for rename / set upstream / confirmations; tooltips; left panel with per-row show / hide and ⋮ menus, collapsible and maximizable sections, Gitflow tree |
| **Workspace** | Repo tabs (rename, reopen closed), repository management, init with .gitignore / license templates, clone options (branch, shallow, submodules), integrated terminal (PowerShell, pwsh, cmd or Git Bash), command palette, light and dark themes, profiles (separate author identities), SSH key generation, GPG / SSH commit signing, per-repo preferences (identity, .gitignore editor, hooks path, commit template) |
| **Preferences** | General (auto-fetch / auto-prune, default branch name, remember tabs, keep submodules updated, line endings, long paths, git executable), UI (toolbar labels, date / time format, notification location, spell check, graph options such as commit descriptions, ghost labels, row highlighting, author initials), Commit (push after commit, skip hooks, strip comments, global template), Commit signing (GPG or SSH, sign tags), SSH, Editor (font, size, tab size, wrap, line numbers, syntax highlighting, line endings), In-app terminal (shell, font, line height, cursor, dim when unfocused), External tools |

## Run

Requires Git for Windows and Node.js.

```bash
npm install
npm run dev        # development with hot reload
npm run build      # production build into out/
npm start          # run the production build
npm run dist       # Windows installer into dist/
npm test           # unit tests (git parsers, line staging, graph layout, branch visibility)
```

Set `SUPERGIT_USER_DATA=<folder>` to run an isolated instance with its own settings (useful for testing alongside your normal instance).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+P | Command palette / fuzzy file finder |
| Ctrl+F | Search commits |
| Ctrl+Enter | Commit (in the commit message) |
| Ctrl+Shift+S / Ctrl+Shift+U | Stage all / unstage all |
| Ctrl+Shift+M | Focus commit message |
| Ctrl+B | Create branch |
| Ctrl+L | Fetch all |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+` | Toggle terminal |
| Ctrl+K | Toggle left panel |
| Ctrl+T / Ctrl+W / Ctrl+Shift+T | Repo management / close tab / reopen closed tab |
| Ctrl+Tab | Next tab |
| Ctrl+, / Ctrl+/ | Preferences / shortcuts list |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom |
| Esc | Close diff / search |

## Layout

- `src/main`: Electron main process.
  - git CLI backend: `gitcore.ts` (parsers), `git.ts` (operations), `extras.ts` (gitflow, LFS, patches, submodules, keys)
  - integrated terminal (`terminal.ts`, node-pty)
  - Azure DevOps client, settings, file watching, undo / redo, native context menus
- `src/preload`: the narrow, typed bridge exposed to the UI (context isolation on, no Node in the renderer).
- `src/shared`: types and the API contract.
- `src/renderer`: React UI. The graph lane algorithm and branch visibility live in `src/renderer/src/graph/`.

Settings live in `%APPDATA%\SuperGit\settings.json`.

## Disclaimer

SuperGit is an independent personal project. It is not affiliated with, endorsed by or sponsored by Axosoft, GitKraken or any other Git client vendor. All product names and trademarks mentioned belong to their respective owners.
