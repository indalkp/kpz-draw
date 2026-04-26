# KPZ Draw — Deploy Workflow

> Reusable reference for AI sessions deploying code changes to indalkp.com/draw.
> Last updated: 2026-04-14 after v3.6.4 release.

---

## Architecture (Why This Workflow Exists)

KPZ Draw is a modular ES6 SPA inside a sandboxed HTML iframe on Wix.
The iframe CANNOT access Wix's /public folder (confirmed Wix staff Sept 2020).
Code is hosted on GitHub and served via jsDelivr CDN, pinned to git tags.

```
GitHub repo (indalkp/kpz-draw)
  -> tagged release (e.g. v3.6.4)
    -> jsDelivr CDN caches tag (~2 min)
      -> Wix HTML Embed loads via VERSION constant
        -> Velo Page Code on /draw bootstraps the iframe
          -> Velo backend (drawingService.web.js) handles save/load
```

Two deployment surfaces:
1. Frontend (GitHub -> jsDelivr -> HTML Embed VERSION bump) -- every release
2. Backend (Velo code paste in Wix Editor) -- only when backend methods change

---

## Repo Layout

```
C:\Users\Admin\Documents\GitHub\kpz-draw\       <- local clone
src/
  core/         state.js, dom.js, events.js
  drawing/      canvas.js, view.js, brush.js, history.js, layers.js, panels.js
  ui/           topbar.js, toolrail.js, layers-panel.js, brush-panel.js,
                references.js, ref-viewer.js, docs-panel.js, panel-nav.js,
                modals.js, projects-panel.js, cursor-overlay.js, toast.js,
                library-modal.js, confirm-leave.js
  storage/      autosave.js, kpz-format.js, persistent-refs.js,
                psd-export.js, wix-bridge.js
  utils/        color.js, dom-helpers.js, idb.js
styles.css
main.js         <- entry point loaded by HTML Embed
```

Wix mirror (for Velo code reference):
```
C:\Users\Admin\Documents\GitHub\Wix-Website\
  Page Code\Main Pages\Draw          <- /draw page Velo code
  Page Code\Main Pages\Dashboard     <- /dashboard page Velo code
  Backend & Public\backend\drawingService.web.js  <- backend
```

---

## Tool Configuration

### Which MCP Does What

| Task | Tool | Notes |
|------|------|-------|
| Read repo files | GitHub MCP (get_file_contents) | Always works. owner=indalkp, repo=kpz-draw |
| Write/edit local files | Desktop Commander (write_file, edit_block) | Flaky -- see Known Issues |
| Read local files | Desktop Commander (read_file) | Flaky -- fall back to GitHub MCP |
| Git operations | Desktop Commander (start_process) | Requires workarounds -- see Git section |
| Wix Editor changes | User does manually | Chrome MCP CANNOT drive Wix Editor |
| Read Wix CMS data | Wix MCP (CallWixSiteAPI) | For data queries only |

### Known Issues (As of 2026-04-14)

1. Desktop Commander freezes randomly. Stalls 4+ min on read_file, edit_block, write_file. Works for 1-3 calls then hangs. Fix: restart Claude Desktop. If repeated, switch to Fallback Mode.

2. PATH not always set after restart. Always use full paths:
   Git: "C:\Program Files\Git\cmd\git.exe"
   Node: "C:\Program Files\nodejs\node.exe"

3. PowerShell & operator can't pipe. Use Start-Process with -RedirectStandardOutput.

4. Start-Process splits multi-word args. A commit message "fix: do thing" becomes "fix:","do","thing". Always use -F (file-based message).

5. GitHub MCP is read-only. push_files returns 403. All writes go through git CLI.

6. Chrome MCP cannot see Wix Editor. Opens in separate window outside tab group.

---

## The Deploy Pipeline

### Step 0: Read Current State

Prefer GitHub MCP (always works):
  GitHub:get_file_contents  owner=indalkp  repo=kpz-draw  path=src/drawing/brush.js

To verify what's on DISK (not yet pushed), use Desktop Commander:
  Desktop Commander:read_file  path=C:\Users\Admin\Documents\GitHub\kpz-draw\src\drawing\brush.js

### Step 1: Edit Files

Option A -- Desktop Commander (preferred when working):

Small edits:
  Desktop Commander:edit_block
    file_path: C:\...\src\drawing\brush.js
    old_string: "<exact text to replace>"
    new_string: "<replacement text>"

Full rewrites:
  Desktop Commander:write_file
    path: C:\...\src\drawing\brush.js
    content: "<full file>"

CHUNKING RULE: write_file has 50-line soft limit. For files >50 lines:
  - Write first ~30 lines with write_file
  - Append subsequent chunks with write_file mode="append"
  - Each append <=30 lines
  - Verify file after all appends

Option B -- Fallback Mode (when DC frozen):
  Write complete file contents into chat as code blocks.
  User opens file in editor, select all, paste, save.

### Step 2: Syntax Check

  & "C:\Program Files\nodejs\node.exe" --check "C:\...\src\drawing\brush.js"

Exit code 0 = clean. If node unreachable, skip but warn user.

### Step 3: Git Status

```powershell
cd C:\Users\Admin\Documents\GitHub\kpz-draw
Start-Process -FilePath "C:\Program Files\Git\cmd\git.exe" -ArgumentList "status","--short" -NoNewWindow -Wait -RedirectStandardOutput out.txt
Get-Content out.txt
Remove-Item out.txt
```

### Step 4: Git Add + Commit

CRITICAL: always use a temp file for the commit message.

Write the message:
  Desktop Commander:write_file
    path: C:\...\kpz-draw\COMMIT_MSG.tmp
    content: "v3.6.4: one-line summary\n\nfile1: what changed.\nfile2: what changed."

Then commit:
```powershell
cd C:\Users\Admin\Documents\GitHub\kpz-draw
$git = "C:\Program Files\Git\cmd\git.exe"
Start-Process $git -ArgumentList "add","-A" -NoNewWindow -Wait
Start-Process $git -ArgumentList "commit","-F","COMMIT_MSG.tmp" -NoNewWindow -Wait -RedirectStandardOutput out.txt -RedirectStandardError err.txt
Write-Output "COMMIT: $(Get-Content out.txt) | ERR: $(Get-Content err.txt)"
Remove-Item out.txt, err.txt -ErrorAction SilentlyContinue
```

Verify output contains [main XXXXXXX] and N files changed.

### Step 5: Git Tag

```powershell
Start-Process $git -ArgumentList "tag","-a","v3.6.4","-F","COMMIT_MSG.tmp" -NoNewWindow -Wait
```

### Step 6: Git Push (main + tag)

```powershell
Start-Process $git -ArgumentList "push","origin","main" -NoNewWindow -Wait -RedirectStandardError err.txt
Write-Output "PUSH MAIN: $(Get-Content err.txt)"
Start-Process $git -ArgumentList "push","origin","v3.6.4" -NoNewWindow -Wait -RedirectStandardError err.txt
Write-Output "PUSH TAG: $(Get-Content err.txt)"
Remove-Item COMMIT_MSG.tmp, out.txt, err.txt -ErrorAction SilentlyContinue
```

Git push output goes to STDERR (normal). Look for:
  main -> main = branch pushed
  [new tag] v3.6.4 -> v3.6.4 = tag pushed

Auth: GCM OAuth cached from prior browser sign-in. Push should be silent.

### Step 7: Verify jsDelivr

URL pattern: https://cdn.jsdelivr.net/gh/indalkp/kpz-draw@v3.6.4/src/main.js
Caches within ~2 min. Can verify with web_fetch but not required.

### Step 8: User Updates Wix (MANUAL)

Template to give user:

  1. Wix Editor -> /draw page -> HTML Embed -> "Enter Code"
  2. Change: const VERSION = 'v3.6.3';  to  const VERSION = 'v3.6.4';
  3. Click Update

  (If backend changes in this release:)
  4. Velo sidebar -> backend/ -> drawingService.web.js
  5. Open mirror file on desktop, Ctrl+A, Ctrl+C
  6. In Wix: Ctrl+A, Ctrl+V, Ctrl+S

  7. Click Publish (top-right)

### Step 9: User Tests

Provide a specific test checklist per release. Example:
  - [ ] Topbar shows v3.6.4
  - [ ] Draw strokes -> refresh -> silent restore, NO popup
  - [ ] File -> New still creates blank project

---

## Version Bump Locations

Every release:
  src/core/dom.js           <small>vX.X.X</small>     AI changes via git
  Wix HTML Embed on /draw   const VERSION = 'vX.X.X'  User changes manually

If backend changed:
  drawingService.web.js in Wix Velo     User pastes full file
  Mirror at Wix-Website repo            AI updates via git

---

## Release Discipline

### Bundling Rules

- Polish bundles NOT touching save/load/state: batch into one release. OK.
- Anything touching save, load, Wix bridge, KPZ format: isolated release.

### Naming Convention

  v3.6.X  patch: bug fixes, small UX improvements
  v3.7.0  minor: new user-facing feature
  v3.8.0  minor: major new system
  v4.0.0  major: breaking changes to KPZ format or Wix integration

### Pre-Release Checklist

  [ ] All changed files pass node --check
  [ ] git status shows ONLY intended files
  [ ] Version badge in dom.js bumped
  [ ] Commit message written to temp file
  [ ] Tag matches version string exactly
  [ ] Both main and tag pushed
  [ ] User instructed on Wix Editor changes
  [ ] Test checklist provided

---

## Fallback Mode (When Desktop Commander Is Broken)

1. STOP trying DC workarounds. Don't waste calls on retries.
2. Read files via GitHub MCP -- always works.
3. Write file contents into chat as code blocks.
4. Tell user to:
   - Open each file in editor, select all, paste, save
   - Open PowerShell in C:\Users\Admin\Documents\GitHub\kpz-draw
   - Run:
     git add -A
     git commit -m "v3.6.4: summary"
     git tag -a v3.6.4 -m "v3.6.4 -- summary"
     git push origin main
     git push origin v3.6.4

100% reliable. Takes user ~5 min.
