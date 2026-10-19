# PR #5 — review fixes for PR #4

Branch `fix/pr4-review-fixes`, based on `feature/scalable-tables-chart-export` (PR #4).
PR #5 targets PR #4's branch. Goals come from the PR #4 review: **Y** = reviewer findings,
**M** = additional issues found while reviewing.

## Goals

| ID | Goal | Decision | Commit |
|----|------|----------|--------|
| Y1 | Switching Linear ↔ Log after zooming distorts the chart | Reset **both** axes to the home view on a scale change (same as Reset view) | 1 ✅ |
| M4 | Scatter ignores `setStatsProvider()` because the worker fit always overrides it | Send `statsOverride` **only when the scatter is sampled** (> 3,000 points). Numbers are unchanged on all 5 examples; metric cards (Pearson, means, medians, SD) and summary tables still come from the worker and are untouched | 2 |
| M1 | Matched pairs "Group / original category order" sorts by the second file's value | Sort by each row's original category position, kept as its own field in the model | 3 |
| Y3 | Sort is one dropdown; only Value/mean has both directions | Split into **Sort by** (column) + **ascending/descending** | 3 |
| Y4 | Statistics table mixes 0, 1 and 3 decimals in one column | One fixed decimal count per column, based on the data's precision, capped at 3; counts stay whole numbers | 4 |
| Y2 | CSV export covers all filtered rows, which isn't obvious | **Text only:** reword the existing table note to say the CSV contains every row matching the current filter and legend, across all pages. Same element and style as the other notes; button label unchanged | 5 |
| M3 | Export filename hard-coded to `steps-sleep-…` | `<A>_vs_<B>__<view>__<rows>r__<id>.csv` — dataset names from header labels (fallback: file names), short view codes (`f1`/`f2`/`pairs` + `obs`/`bycat`/`bygrp`, `-flt` when filtered or legend groups hidden), row count, and a 6-character fingerprint of the cleaned data so different versions of the same dataset pair get different names | 5 |
| M2 | Toggling a legend item rebuilds the charts and drops keyboard focus | `main.js` only: remember chart + group when the toggle came from a focused legend button, then focus that group's new button after the redraw (no scroll). Covered cases: highlighted item (focus re-applies the same highlight), group not on the current legend page (do nothing), another update first (pending refocus replaced or cleared), toggle not from the focused button (do nothing) | 6 |
| Y6 | Plot width is set per chart | One compact global width dropdown in the existing pinned bar; Fullscreen stays per chart; width dropdown hidden below ~600px | 7 |
| Y7-6a | Narrow screens: Fullscreen lands mid-row when the toolbar wraps | **Local CSS only:** Fullscreen pushed to the right end of its row (`margin-left: auto`) | 8 |
| Y7-6b | "Show data table" and Copy image / Save PNG sit on different rows | **Local fix:** insert the table button as the first item of the existing image-actions row (one line in `main.js`) + one CSS rule to keep it left, image buttons right; one test selector narrowed to the image buttons | 8 |

| Y5 | The filter row (search, overview, means/trend) scrolls away | **CSS only:** pin the existing filter row directly under the pinned bar on wide screens; unpinned on narrow screens where space is limited | 9 |

Commits 8 and 9 are kept separate so each can be dropped on its own if a layout regression appears.

## Decisions taken

- Y3: "Sort by" includes Median, SD, Min and Max for summary tables.
- M3: filename format as above.
- Y5: option (a), CSS-only pinning on wide screens, as its own commit.

## Out of scope (follow-ups)

- **Y8** — pinned basic-statistics row: a design decision for the team.
- Running a custom stats provider inside the worker, so sampled (> 3,000 point) scatters can use it too.
- With a custom provider set, the Pearson card (worker) and the scatter legend (provider) could show different r.
- Redrawing only the toggled chart instead of all three after a legend click.
- `// @ts-check` missing from `main.js` and the new PR #4 modules.

## Verification for every commit

- `npm test` and `npm run check:stats` pass; each fix adds a test that fails before it.
- Commits 8 and 9: before/after measurements at 375, 560, 1024 and 1920 px — Fullscreen right-aligned when the toolbar wraps, table and image buttons on one row whenever they fit, no overlap, no horizontal scroll.
- Final browser pass on desktop, 560 px and 375 px, Canvas and SVG, light and dark.
