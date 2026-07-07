# Code Review — 2026-07-07

Full review of `src/` (~4,700 lines) and tests, performed with Claude Code (Fable 5).
Scope: (1) core CDP plumbing, (2) trap-prone tools (pine/replay/alerts), (3) everything else.
Tests at review time: **16/17 pass** (only `e2e.test.js` failed — required a live TradingView
with CDP on :9222 and hard-failed instead of skipping; fixed same day, `npm test` is now green
offline with the e2e suite skipping cleanly).

Overall verdict: codebase in good shape — consistent error handling, defensive DOM scripting,
sensible fallback chains. Findings below, numbered as referenced in code comments.

## Context: related work same day

- The 5 skills in `skills/` were synced with the battle-tested Pine workflow knowledge from
  the Trademaster project's `create-indicator` skill (commit `2d6c0bb`): deploy sequence,
  never-use list, verification protocol, Pine trap table.
- `pine_smart_compile`'s misleading deprecation hint was fixed in the same commit.
- The richer, project-specific version of the Pine workflow lives in
  `C:\Users\Anwender\OneDrive\Trademaster\.claude\skills\create-indicator\SKILL.md`.
- After the O1 fix, both that skill and `skills/pine-develop` were updated to check
  `pine_open`'s `method` field (`ui_open`/`already_open` safe; `facade_fallback` = injection
  only, do not save blindly).

## FIXED in this review's commit

| # | File | Issue | Fix |
|---|------|-------|-----|
| P1-1 | `src/server.js` | `instructions` block recommended deprecated `pine_smart_compile` (destroys `pine_set_source` changes) to every MCP client | Rewritten to `pine_set_source → pine_save → pine_compile → pine_get_errors` + explicit never-use warning |
| P1-3 | `src/connection.js` | Retry loop slept up to 8 s AFTER the final failed attempt before throwing | Sleep skipped on last attempt |
| P1-4 | `src/wait.js` | Timeout comment said "return true anyway", code returns `false` | Comment corrected |
| P1-5 | `src/server.js`, `CLAUDE.md` | Tool count drift (78 / 68 vs. actual 77) | Both set to 77 |
| 2 | `src/core/alerts.js` | `greater_than`/`less_than` silently map to CROSSING conditions — an alert set while price is already beyond the level never fires | Documented in `CONDITION_MAP` comment + `note` field in the `alert_create` result. Semantics NOT changed (see Open #2b) |
| 5 | `src/core/pine.js` | `pine_analyze` note still recommended `pine_smart_compile`; core `smartCompile()` is dead code | Note now points to `pine_check`/`pine_compile`; dead-code warning comment added |
| 7 | `src/core/batch.js` | `batch_run` screenshot filename used raw symbol — `BATS:TSLA` contains `:`, invalid on Windows → `writeFileSync` throws | Symbol/timeframe sanitized to `[A-Za-z0-9._-]` |
| 8 | `src/core/morning.js` | `assertSafeRulesPath` used hardcoded `"/"` — never matches Windows backslash paths, so custom `rules_path` was always rejected on Windows | Uses `path.sep` |
| 1-doc | `src/tools/pine.js` | — | `pine_open` description now warns it injects source without switching the editor's backing script (overwrite risk on save) |
| 6-doc | `src/tools/tab.js`, `src/core/tab.js` | — | `tab_switch` description/comment now state it's visual-only; CDP client stays on the old target |
| O6 | `src/core/data.js`, `src/core/batch.js` | `study_filter`/`entity_id`/`symbol`/`tf` interpolated unescaped into evaluated JS — a quote in the value broke the call | All interpolations `JSON.stringify`-escaped |
| O8 | `src/connection.js` | No concurrency guard — overlapping `getClient()` calls could open and leak parallel CDP connections | Shared in-flight promise added |
| O11 | `src/core/index.js` | Public API missing `pane`, `tab`, `morning`, `stream` exports | Added |
| O12 | `tests/e2e.test.js` | Hard-failed (`process.exit(1)`) without live TradingView, breaking `npm test` offline | Probes CDP up front, skips suite with actionable message — `npm test` now green offline |
| O4 | `src/connection.js`, `src/core/tab.js`, `src/tools/tab.js` | `tab_switch` was visual-only — cached CDP client stayed bound to the old tab | New `connectTo(targetId)` rebinds the client after activation; result includes `reconnected` + `active_symbol` as proof. Live-verified 2026-07-07 (read `BATS:MU` through the new connection) |
| O2b/O3 | `src/core/alerts.js`, `src/tools/alerts.js` | `greater_than`/`less_than` silently mapped to crossing conditions; payload hardcoded USD/1-min/extended | `greater`/`less` are true static API condition types (live-verified: static alert fires immediately when price already beyond level); currency/session/resolution now read from the active chart when the alert targets its symbol (safe defaults otherwise). End-to-end re-verified via create+delete of a test alert |
| O1 | `src/core/pine.js`, `src/tools/pine.js` | `pine_open` only injected source into the currently open script — a later save could overwrite a different script | `openScript` now drives TradingView's own "Open script…" dialog (script-title menu → Open script… → **trusted CDP double-click** on the row; synthetic JS clicks are ignored). Verifies the title switched; falls back to legacy facade injection with an explicit `warning` + `method: "facade_fallback"`. Live-verified 2026-07-07 both directions (9 EMA Reclaim Scalp ↔ RVOL and ATR) plus `already_open` path. Discovery notes: Pine editor here runs as a floating `pine-dialog` (position:fixed → `offsetParent` visibility checks give false negatives); open-dialog rows need trusted CDP mouse input |

## E2E baseline (live, 2026-07-07)

`npm test` against the live session: **92/95 pass** (~2 min). The three failures:
- `tv_launch` binary detection — environment (MSIX/Brave, see Open #9), not code.
- `ui_open_panel` close — real bug: TradingView removed `hideWidget` from
  `bottomWidgetBar`; **fixed** with `hide()`/`close()` fallback in `src/core/ui.js`
  (live-verified: pine-editor open/close both succeed, bottom panel confirmed closed).
- `replay_stop` — test-order flake: the test calls `goToRealtime` directly after replay
  already stopped; core guards this correctly (see Open #15).

## OPEN — for a future session

Ordered by value. Items needing a **live TradingView (CDP)** to verify are marked ⚡.
(Numbering preserved from the original review; items 6, 8, 11, 12 were fixed same day — see O-rows above.)

5. **English-only button matching** in `src/core/pine.js` `compile()`/`save()` (regexes like
   `/save and add to chart/i`, `text === 'Save'`). Falls through to weaker fallbacks on non-English
   TradingView UI. Add localized alternatives or prefer `data-name`/class-based selectors.
7. **2-decimal rounding** in `data.js` pine lines/labels/boxes (`Math.round(v*100)/100`) loses
   precision on forex/crypto (e.g. EURUSD 1.08543 → 1.09). Round adaptively (use the symbol's
   `pricescale`/`minmov` from `symbolExt()`), or return raw with a formatted twin.
9. **`tv_launch` can't work with MSIX TradingView on Windows** (`src/core/health.js`): searches
   only classic `.exe` paths; also `taskkill /F /IM TradingView.exe` by default. Error message
   should mention the browser-CDP alternative (e.g. Brave with `--remote-debugging-port=9222`,
   which is how this machine runs it — desktop shortcut "TradingView (CDP)").
10. **`wait.js` bar-count heuristic** counts `[class*="bar"]` (matches toolbar/sidebar too).
    Works as a change-detector, but rename/tighten if touched.
13. **`replay_start` time-seek** (`src/core/replay.js`): up to 1000 `doStep()` round-trips with no
    `target_reached` flag in the result. Add the flag; consider a coarser seek.
14. **Minor cosmetics:** `xhrEval(path, bodyObj)` has an unused param; `window._xhrPayload`
    global pollution; `symbolSearch` hardcodes `lang: 'en'`.
15. **`tests/e2e.test.js` replay_stop test is order-dependent** — it calls `goToRealtime`
    directly even when an earlier test already stopped replay; wrap in an isReplayStarted
    guard like `src/core/replay.js` does.

## How to continue

1. Open this file, pick the next item (top of OPEN list = highest value).
2. ⚡ items: start TradingView via the "TradingView (CDP)" shortcut first and verify with
   `tv_health_check`; test changes against the live chart before committing.
3. After fixing an item, move its row/entry to FIXED with a one-line description of the fix,
   and commit with a message referencing this document.
