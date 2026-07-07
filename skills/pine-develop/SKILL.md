---
name: pine-develop
description: Full Pine Script development loop — write code, deploy to TradingView, compile, fix errors, verify on the chart, iterate. Use when building or modifying an indicator or strategy in TradingView.
---

# Pine Script Development Loop

You are developing a Pine Script indicator or strategy in TradingView. Follow this loop precisely.

## Step 0: Preflight (before writing any code)

1. `tv_health_check` — verify the CDP connection works. If it fails, TradingView must be
   started with remote debugging enabled (`--remote-debugging-port=9222`; `tv_launch` can do
   this). Do NOT start deploying into a dead connection — CDP failures have burned whole sessions.
2. `chart_get_state` — note the current symbol/timeframe and any existing instance of the
   script (its `studies[].id` entity ID; needed for input updates and verification later).

## Step 1: Understand the Goal

If not already clear, ask the user:
- What type? (indicator, strategy, library)
- What does it do? (entry/exit logic, overlay, oscillator, etc.)
- Overlay or separate pane?
- Any specific inputs or visual elements?

## Step 2: Pull Current Source (if modifying)

If modifying an existing script: `pine_get_source`, or `node scripts/pine_pull.js` (writes to
`scripts/current.pine`). If creating new: start from scratch.

## Step 3: Write the Pine Script

Every script MUST include:
- `//@version=6` header
- Proper `indicator()` or `strategy()` declaration
- All user inputs with `input.*()` functions and groups
- Clear comments for each logical section

For strategies, include `strategy.entry()`/`strategy.exit()` calls, position sizing via the
`strategy()` declaration, and default commission and slippage settings.

**Alerts: always `alertcondition()`, NEVER `alert()`.** `alert()` creates a
"Crossing [current price]" condition — the price at alert-creation time gets frozen as a fixed
threshold. Placeholders in `message` are TradingView placeholders (`{{ticker}}`, `{{close}}`,
`{{interval}}`), not Pine variables. Multiple `alertcondition()` calls appear as separate
dropdown options.

Known Pine traps (each has cost real sessions):

| Trap | Fix |
|---|---|
| `ta.vwap(hlc3, false, 1)` — cumulative VWAP, never resets | `ta.vwap(hlc3, timeframe.change("1D"), 1)` |
| `plotshape(location.belowbar)` mixed with price-anchored labels | anchor both as `label.new` with `yloc=yloc.price` at ATR offsets — screen-anchored + price-anchored drifts apart on zoom |
| Raw %-over-N-bars thresholds don't generalize across symbols/timeframes | ATR-normalize every threshold |
| `time("1", ...)` session checks | only correct on 1-min charts — derive from `timeframe.period` |

## Step 4: Deploy and Compile

Two equivalent paths — pick one, don't mix them mid-loop:

**A) MCP tools (exact sequence, no substitutions):**
1. `pine_open(name=...)` — open the script. Sporadically fails on the 1st attempt
   ("Could not open Pine Editor") → retry the same call once; the 2nd attempt reliably works.
2. `pine_set_source` — inject the code.
3. `pine_save` — save (Ctrl+S). **Saving alone does NOT update the on-chart instance.**
4. `pine_compile` — compile + apply to chart (Ctrl+Enter). **Mandatory after every code
   change**, even for a script already on the chart. Its response text can be misleading —
   ignore the message, verify in Step 6 instead. Manual fallback: focus the editor,
   `ui_keyboard(key="Enter", modifiers=["ctrl"])`.
5. `pine_get_errors` — must be 0 errors.

**B) Helper script:** write the code to `scripts/current.pine`, then `node scripts/pine_push.js`
— injects, clicks compile, and reports errors in one step.

**Never use:**
- `pine_smart_compile` — DEPRECATED: it clicks "Save" internally, which reloads the last
  server-saved version and destroys any changes injected via `pine_set_source`.
- `pine_new` — unreliable; use `pine_open` + `pine_set_source` instead.
- `pine_get_source` as proof of deployment — it reads the editor DOM, not compiled state, so
  it always "succeeds".

Updating an existing on-chart script under the same name keeps the instance but its saved
input values stay on old defaults. Set them explicitly:
`indicator_set_inputs(entity_id, {"in_0": ..., "in_5": false})` (0-based, order = order in
code; booleans as JSON booleans; `updated_inputs: {}` in the response means a wrong index).

## Step 5: Fix Errors

If errors are reported:
1. Read the error messages (line number + description)
2. Fix the specific lines and redeploy (Step 4)
3. Repeat until 0 errors — max 3 attempts, then stop and report the error honestly

Common Pine Script errors:
- **"Mismatched input"** — usually indentation (Pine uses 4-space indentation, not braces)
- **"Could not find function or function reference"** — typo in function name or wrong version
- **"Undeclared identifier"** — variable used before declaration
- **"Cannot call X with argument type Y"** — wrong parameter type

## Step 6: Verify on Chart (mandatory — before claiming anything)

Never report "deployed" or "fixed" based on tool responses alone — false done-claims are the
single most trust-damaging failure. Prove the new version is live:
- `capture_screenshot(region="chart")` — look at it: is the new/changed feature actually
  visible (new color, new label, signal gone/present)?
- For value checks: `data_get_study_values(study_id=<entity_id>)` — confirm outputs exist and
  are plausible. (Values plotted with `display=display.none` are NOT readable here.)
- If a specific bar must be checked, navigate with `chart_scroll_to_date(date=...)` — do NOT
  feed `data_get_ohlcv` timestamps into `chart_set_visible_range` (different, offset timestamp
  bases; known unreliable).
- `data_get_strategy_results` — if it's a strategy, check performance.

Only after the screenshot/values confirm the change: report done, listing any
`alertcondition()` titles so the user knows which alerts they can create. If they don't
confirm it, say exactly what you see instead — do not soften it.

Alert creation caveat: `alert_create` only handles price-level alerts. Indicator alerts must
be created through TradingView's own dialog (chart focus → Alt+A → select indicator → select
the alertcondition title → Create); a wrongly created alert shows `"Crossing <price>"` with a
frozen `"value"` in `alert_list` — delete it (`alert_delete` works reliably) and recreate.

## Step 7: Iterate

If the user wants changes: pull fresh source (in case TradingView modified anything), edit,
redeploy (Step 4), verify (Step 6). Always compile after every change. Never claim "done"
without a clean compile AND on-chart verification.
