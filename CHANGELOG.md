# Changelog

All notable changes to KPZ Draw. Dates are IST.

## 2026-05-21 — REVERT: undo v3.26.0 + v3.27.0 design integration attempt

**REVERTED v3.26.0 / v3.27.0 — design integration attempt rolled back; resuming from v3.25.x baseline.**

The "Essential" mode work shipped as v3.26.0 (Both/Canvas/Script mode toggle) and v3.27.0 (Script mode UI) did not land cleanly. Both tags and their GitHub Release objects have been removed; `main` is reset to `v3.25.0` (commit `6d28339`, the "sketchy paper theme — first v3 design line increment").

What happened:
- `git tag -d v3.26.0 v3.27.0` (local) + `git push origin --delete` (remote) — both tag objects gone.
- `gh release delete v3.26.0 v3.27.0 --repo indalkp/kpz-draw --yes` — both GitHub Release entries gone. v3.25.0 is now "Latest" again.
- `main` force-pushed from `ca294d5` (README/docs work atop v3.19.0, which had separately diverged from the v3.25 design line) → `6d28339` (v3.25.0).
- Pre-revert `main` HEAD preserved at branch `backup/main-pre-revert-2026-05-21` on both local and origin.
- v3.26.0 and v3.27.0 source trees archived to `E:\Projects\web-dev\kpz-draw_archive\v3.26.0\` and `\v3.27.0\` as zips so the work can be revisited if the design integration is retried.

What is NOT changed:
- Wix Velo's `KPZ_VERSION` constant remains pinned at `v3.18.1` per prior audit. The live `indalkp.com/draw` page is unaffected by this revert — it has been serving v3.18.1 throughout. The dynamic shim's fallback path (`@main`) will now resolve to v3.25.0 if Velo ever fails to respond, instead of the prior v3.19.0+docs state.
- jsDelivr cache for `@v3.26.0` and `@v3.27.0` will continue to serve from the immutable historical tag content (jsDelivr keys by tag-at-push-time). That's expected; no live consumer is configured to request those tags.

Tag for traceability: `v3.25.x-revert-2026-05-21` points at this revert commit.

---

## Prior history

The bulk of the project's history pre-dates this changelog and lives in:
- Git tags (`git tag -l --sort=-v:refname`), where every release from v3.6.x onward has both an annotated tag and a GitHub Release object (backfilled 2026-05-09; see `outputs/20260508_kpzdraw_releases/20260508_kpzdraw_release_audit.md` in older snapshots).
- Commit headlines (`git log --oneline`), where each `vX.Y.Z:` prefix names the change shipped in that tag.
- The dedicated `DEPLOY-WORKFLOW.md` (root) and the `kpz-deploy-workflow` skill at `~/.claude/skills/kpz-deploy-workflow/SKILL.md` for the operational pipeline.
