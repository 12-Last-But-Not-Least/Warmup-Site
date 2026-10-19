# Renderer and table implementation notes

## Branch integration

The feature branch starts from `ui/renderer-controls` at `eeecac7df4666134a6092854815513d6a3bb6916`. Its PR targets that same branch. Open PRs checked during preparation:

| PR | Head | Base | Integration |
| --- | --- | --- | --- |
| #1 | feature/canvas-log-scale at e55aa79 | main | Already an ancestor of the requested parent |
| #2 | feature/grouped-stats at 61c7ce3 | main | Merged into this child; grouped APIs and existing synchronous provider retained |
| #3 | ui/renderer-controls at eeecac7 | feature/canvas-log-scale | Direct parent; its renderer and accessibility improvements retained |

Current main at `36fa40d` is also merged, preserving its normalized duplicate-name parser and fifth example. The grouped-stats merge had a textual conflict in `src/stats.js`; both the provider API and grouped helpers are retained. Its duplicate-row sanity check is adapted to main's first-valid-cell rule (two retained values, mean 1.5), rather than counting four conflicting observations.

This integrates the checked heads without changing or merging the other GitHub PRs. Future commits to those branches can still require reconciliation. Merge cleanliness does not establish identical behavior across arbitrary merge orders or future changes.

## Changes relative to the parent

| Area | Parent | This change |
| --- | --- | --- |
| Data tables | Complete raw table under each plot | One collapsed, source-selectable inspector with capped pages, summaries, global sorting and complete filtered CSV export |
| Data processing | Page-thread file parsing and pairing | Chunked worker parsing, explicit input budgets, cancellable imports/exports and atomic dataset replacement |
| Drawing | Unbounded individual marks and legend | 3,000-point cap, labelled category averages above 20 line groups, searchable/paged legend |
| Statistics | Existing scatter fit and grouped-statistics work on separate branches | Full-visible-data counts, means, medians, sample SD and grouped tables; fit, mean and log configuration |
| Legend hiding | Per-chart hide/show | Preserved, including all-hidden recovery; corresponding statistics, table and CSV follow that chart's visibility |
| Sizing | Responsive card with fixed page cap | Per-chart maximum width and native fullscreen, with in-page fallback |
| Images | None | Adjacent Copy image / Save PNG controls at each plot's bottom right; theme, title, visible legend and sampling caption |
| Runtime parser | CDN import | Licensed local ESM wrapper in src/vendor, already included by the existing Pages src staging rule |

Preserved parent behavior includes the segmented sticky renderer bar, active example styling and forced-colors weight, measured category-label thinning, mobile size floor, r/n in the legend, chart order, existing examples, auto-loading after both files are chosen, panning/zoom/reset, tooltip highlighting and system light/dark styling. UI strings, source comments and documentation are English; uploaded labels are displayed as text without translation.

## Data flow

1. File selection or an example creates a candidate worker. The prior active model remains usable until the candidate successfully parses both files.
2. The parser reads chunks, checks budgets and applies the same numeric/duplicate rules as direct `buildPlotData`. The model normalizes names, pairs by category and retains complete cleaned data in the worker.
3. A view request carries the shared group query, line mode and independent per-chart hidden-group arrays. The worker returns full-data summaries, extents, log exclusion counts, bounded drawing payloads and complete group-name metadata for restoring hidden groups.
4. Main renders Canvas/SVG while retaining state during legend changes. Per-chart controls handle width and fullscreen; replacement removes event listeners and observers.
5. Table requests carry source, display, sorting, exclusions and page. Sorting precedes slicing. CSV requests use that same table model but serialize every row in cancellable batches of 1,000.
6. Image export rasterizes the current Canvas or computed-style-inlined SVG into a bounded PNG, adds context, then invokes clipboard write or a local download. Browser clipboard/encoding errors stay inline.

The worker owns analysis scope. Pagination, deterministic drawing samples and log axes do not change raw-unit statistical populations. Hiding a group or changing the group filter does change the corresponding analysis population. Paired group/category summaries describe Y, explicitly stated in the UI.

## Validation

- 33 automated Node tests pass, including the parent's category-label and stats-provider checks.
- The inherited grouped-statistics sanity script passes across bundled CSVs and its edge cases, with the duplicate expectation aligned to main.
- Tests cover pairing/duplicate conflicts, full-data summaries, 10,000-group drawing budgets, table sorting/pages, complete and cancelled CSV exports, per-chart hiding/restoration, original examples/selection, width and expanded-view lifecycle, listener cleanup and image export/clipboard-error contracts.
- DOM tests substitute drawing contexts, decoding, clipboard permissions, worker transport and example-file transport. Actual model/worker parsing and serialization are exercised separately.
- Test dependencies were read from the existing local environment after the package-install approval service failed due to model capacity. The lockfile reuses existing pinned npm metadata; npm Arborist loads its virtual dependency graph without dependency errors. A fresh `npm ci` has not been run in this session.
- Browser automation was rejected before opening the page because the automatic approval service reported model capacity exhaustion. Real PNG pixels, native clipboard success, native fullscreen, live system-theme switching and responsive visual layout are **not browser-verified in this revision**.

Before marking the PR ready, run a clean install/test pass and manually check all five examples; independent hide/restore including all-hidden; 25/50/100-row tables and all-page CSV; Canvas/SVG PNG output; copy success/denial; numerical Log with non-positive values; native/fallback fullscreen; width changes; system light/dark; and a 360 px viewport. Keep this limitation visible in the PR description.
