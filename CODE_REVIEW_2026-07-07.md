# Code Review — 2026-07-07

Full review of `src/` (~4,700 lines) and tests, performed with Claude Code (Fable 5).
Scope: (1) core CDP plumbing, (2) trap-prone tools (pine/replay/alerts), (3) everything else.
Tests at review time: **16/17 pass** (only `e2e.test.js` fails — it requires a live TradingView
with CDP on :9222 and hard-fails instead of skipping; see Open #12).

Overall verdict: codebase in good shape — consistent error handling, defensive DOM scripting,
sensible fallback chains. Findings below, numbered as referenced in code comments.

## Context: related work same day

- The 5 skills in `skills/` were synced with the battle-tested Pine workflow knowledge from
  the Trademaster project's `create-indicator` skill (commit `2d6c0bb`): deploy sequence,
  never-use list, verification protocol, Pine trap table.
- `pine_smart_compile`'s misleading deprecation hint was fixed in the same commit.
- The richer, project-specific version of the Pine workflow lives in
  `C:\Users\Anwender\OneDrive\Trademaster\.claude\skills\create-indicator\SKILL.md`.

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

## OPEN — for a future session

Ordered by value. Items needing a **live TradingView (CDP)** to verify are marked ⚡.

1. ⚡ **`pine_open` doesn't switch the editor's backing script** (`src/core/pine.js` `openScript`).
   It fetches the saved source via pine-facade and `setValue()`s it into the currently open
   script. A later Ctrl+S saves under the wrong identity → can silently overwrite a different
   script. Proper fix: drive TradingView's own "Open script" dialog (Pine Editor → Open menu),
   or find an internal API that actually switches the script. Documented for now.
2. ⚡ **(2b) True greater/less alert conditions.** Probe the pricealerts REST API for static
   threshold condition types; if they exist, map `greater_than`/`less_than` to them properly.
3. ⚡ **`alert_create` hardcodes `currency-id: "USD"`, `resolution: '1'`, `session: "extended"`**
   (`src/core/alerts.js`). Verify behavior on EUR instruments (DAX) and derive currency/session
   from the active chart's `symbolExt()` instead.
4. ⚡ **`tab_switch` should reconnect** (`src/core/tab.js`): after `/json/activate/<id>`, call
   `disconnect()` and reconnect the CDP client to the activated target id; `findChartTarget`
   currently just picks the first `/chart/` target.
5. **English-only button matching** in `src/core/pine.js` `compile()`/`save()` (regexes like
   `/save and add to chart/i`, `text === 'Save'`). Falls through to weaker fallbacks on non-English
   TradingView UI. Add localized alternatives or prefer `data-name`/class-based selectors.
6. **JS-injection robustness in `src/core/data.js`**: `buildGraphicsJS` interpolates
   `study_filter` into a single-quoted JS string unescaped; same for `entity_id` (`getIndicator`)
   and `symbol` (`getQuote`). A quote/backslash in the value breaks `evaluate()`. Use
   `JSON.stringify` interpolation like the newer code does.
7. **2-decimal rounding** in `data.js` pine lines/labels/boxes (`Math.round(v*100)/100`) loses
   precision on forex/crypto (e.g. EURUSD 1.08543 → 1.09). Round adaptively (use the symbol's
   `pricescale`/`minmov` from `symbolExt()`), or return raw with a formatted twin.
8. **No concurrency guard** in `src/connection.js` `getClient()`/`connect()` — two overlapping
   calls can open two CDP connections and leak one. Add a shared in-flight promise.
9. **`tv_launch` can't work with MSIX TradingView on Windows** (`src/core/health.js`): searches
   only classic `.exe` paths; also `taskkill /F /IM TradingView.exe` by default. Error message
   should mention the browser-CDP alternative (e.g. Brave with `--remote-debugging-port=9222`,
   which is how this machine runs it — desktop shortcut "TradingView (CDP)").
10. **`wait.js` bar-count heuristic** counts `[class*="bar"]` (matches toolbar/sidebar too).
    Works as a change-detector, but rename/tighten if touched.
11. **`src/core/index.js`** public API is missing `pane`, `tab`, `morning`, `stream` exports.
12. **`tests/e2e.test.js` hard-fails without live TradingView.** Should detect CDP absence and
    `t.skip()` so `npm test` is green offline.
13. **`replay_start` time-seek** (`src/core/replay.js`): up to 1000 `doStep()` round-trips with no
    `target_reached` flag in the result. Add the flag; consider a coarser seek.
14. **Minor cosmetics:** `xhrEval(path, bodyObj)` has an unused param; `window._xhrPayload`
    global pollution; `symbolSearch` hardcodes `lang: 'en'`.

## How to continue

1. Open this file, pick the next item (top of OPEN list = highest value).
2. ⚡ items: start TradingView via the "TradingView (CDP)" shortcut first and verify with
   `tv_health_check`; test changes against the live chart before committing.
3. After fixing an item, move its row/entry to FIXED with a one-line description of the fix,
   and commit with a message referencing this document.
