# Steps & Sleep

A small website where you upload two CSV files and get three interactive charts:

1. **A line chart of the first file:** one line per person (or group) across the columns.
2. **A line chart of the second file:** the same, for the second file.
3. **A scatter plot of one file against the other:** one dot per person per column,
   with a trend line and a number (r) showing how strongly the two move together.

It was built for daily steps and hours of sleep, but it works with any two files
in the same layout: study hours and quiz scores, temperature and sales, and so on.

Everything runs in the browser. The files you upload are never sent anywhere.

---

## How to run it

You need [Node.js](https://nodejs.org) installed, but only to start a small local
web server. There is nothing to build.

```sh
npm start
```

Open http://localhost:3000. (`npx serve` works too.)

> Double-clicking `index.html` won't work. Browsers block this kind of JavaScript
> when a page is opened straight from your disk, so it has to come from a server,
> even a local one.

---

## Linting

Install dependencies with `npm ci` (Node.js 24 is used in CI), then run:

```sh
npm run lint
npm run lint:fix
```

`lint` checks all JavaScript with ESLint's recommended rules and fails on any
errors or warnings. `lint:fix` applies available automatic fixes; any remaining
issues must be fixed manually. Browser globals apply to `src/`, while `server.js`
uses Node.js and CommonJS. `src/data.js` also allows Node.js globals for its CLI.
Generated `_site/` output and `node_modules/` are ignored.

The **Lint** GitHub Actions workflow runs on every pull request and pushes to
`main`. Run the same lint command before submitting changes. To require a passing
check before merging, a repository administrator can make `lint` a required status
check in the branch protection settings for `main`.

### Fix a branch from GitHub

After this workflow is merged into `main`, open **Actions → Fix lint → Run
workflow**, choose the branch in **Use workflow from**, and click **Run workflow**.
The selected branch must contain the workflow and lint configuration.

The action runs `npm run lint:fix` and commits any fixes to tracked JavaScript
files back to that same branch. Open PRs from the branch update automatically.
If nothing changes, no commit is created. Fixes are committed even if other lint
errors remain; the final check fails until those remaining issues are fixed manually.

The action uses GitHub's built-in token, so no extra secret is needed. Its bot
push does not trigger another automatic CI run; the action runs lint again itself.
If a PR requires a separate check on the new commit, run **Lint** manually on that
branch. Branch protection still applies, and a concurrent branch update can reject
the push; rerun the action on the updated branch in that case.

---

## How to use it

1. Pick a file for **First CSV** and another for **Second CSV**.
2. The charts appear. The line under the title says how many people were loaded
   and how many pairs made it onto the scatter plot.

Or click one of the **example** buttons to load a ready-made pair of files.

**On the charts:**

| To do this | Do this |
|---|---|
| See exact values | Hover over a dot |
| Focus on one person | Hover over their name in the legend |
| Hide or show a person | Click their name in the legend |
| Zoom in or out | Hold Ctrl (or ⌘ on a Mac) and scroll, or pinch on a trackpad |
| Move around | Click and drag |
| Go back to the full view | Double-click the chart, or press **Reset view** |
| See the raw numbers | Open **Show data table** under a chart |

---

## What the files should look like

One row per person (or group), one column per category, numbers in the cells.
Google Sheets exports in this layout work as they are (**File → Download → CSV**).

```
Step Count,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday
Eita,3608,4246,4116,5500,4207,3590,4563
Jay,7440,10560,6566,9767,3235,5623,2404
```

- **Top-left cell:** what the numbers mean (`Step Count`, `Hours of Sleep`, `Quiz Score (%)`).
  It becomes the chart title and axis label.
- **Rest of the first row:** the categories along the bottom of the line charts
  (weekdays here, but they could be weeks, months, anything).
- **First column:** the people or groups. Each one gets its own colour and line.
- **Everything else:** numbers.

**How the two files are paired for the scatter plot:** by person and column name.
Jay's Monday steps go with Jay's Monday sleep, even if the second file lists its
columns in a different order. A person or column that's only in one file still
appears on that file's line chart but is left off the scatter plot.

**Validation rules:**

Both uploads and example buttons use `parseCsv(text)` in `src/data.js`.
Papa Parse reads comma-separated records with quoted fields, escaped quotes,
UTF-8 BOMs, and LF or CRLF line endings. Validation then enforces this layout:

- At least two columns: a metric name and one or more categories.
- All header names must be nonempty and unique after trimming whitespace.
- Person/group names are trimmed and case-sensitive; duplicate names are errors.
- Nonblank records must contain the same number of fields as the header.
- Measurements accept finite decimal numbers, including negatives and scientific
  notation. Blanks are missing values, never zeros. Units and thousands separators
  in numeric cells are not supported.
- Each file must have at least one usable numeric observation.

**Errors** block charting: empty/nontext input, malformed CSV quoting, invalid
headers, duplicate people, or no usable numeric data. Previous charts are hidden.
**Warnings** skip only the affected data: wrong-width rows, blank group names,
blank measurements, or nonnumeric measurements. Completely blank rows are ignored.
Messages include the filename and record/column where available. Record numbers
include the header; a quoted multiline field still belongs to one CSV record.

The files may have different metrics, people, categories, and ordering. Pairing
uses trimmed, case-sensitive person and category names. If no valid observations
match, a warning explains the empty scatter plot and both line charts remain.

Run the CSV validation tests with `npm test` after `npm install`.

---

## What's inside

```
index.html          the page: upload buttons, example buttons, spaces for the charts
styles.css          colours, layout, light and dark mode
src/
  main.js           connects everything: reads the files, prepares the charts, draws them
  data.js           reads a CSV file and turns it into one list of points per person
  chart.js          draws the charts (written from scratch, no chart library)
  stats.js          the maths for the trend line and r
data/
  DATA - Step Count.csv, DATA - Hours of Sleep.csv     the team's real data
  examples/         made-up example pairs used by the example buttons
server.js           tiny local web server for `npm start`
```

### How the pieces fit together

```
two CSV files
      │
      ▼
data.js     reads each file separately → for each person, a list of [x, y] points
      │     plus the file's labels (title from the top-left cell, column names)
      ▼
main.js     builds three chart descriptions:
            a line chart for each file, and a scatter that pairs the two files
            by person and column name
      │
      ▼
chart.js    draws each chart
```

### Each file in a bit more detail

**`src/data.js`** (CSV reading). Main function:

```js
const { series, valueHeader, xTickLabels, errors, warnings } = buildPlotData(csvText);
```

- `series`: one entry per person, e.g. `{ group: 'Jay', points: [[0, 7440], [1, 10560], ...] }`.
  The first number in each point is the column position (0 = first column after the names).
- `valueHeader`: the top-left cell, e.g. `'Step Count'`.
- `xTickLabels`: column names by position, e.g. `{ 0: 'Monday', 1: 'Tuesday', ... }`.
- `errors`: blocking validation messages.
- `warnings`: plain-English messages about anything skipped.

`parseCsv(text)` returns `{ columns, rows, errors, warnings }`. Rows contain
trimmed strings with invalid measurements replaced by empty strings. Callers must
check `errors` before using the rows. `buildPlotData()` validates once and returns
no series when errors exist.

It uses [Papa Parse](https://www.papaparse.com/) to read CSV files correctly.
`index.html` loads Papa Parse from a CDN, which is why there's nothing to install
for the website.

**`src/main.js`** (the glue). Parses both files, shows any warnings, then draws the
two line charts and the scatter plot. It doesn't mention steps or sleep anywhere;
titles and labels all come from the files.

**`src/chart.js`** (the charts). One function draws all three:

```js
drawScatter(whereToDraw, chartDescription);
```

A chart description looks like this:

```js
{
  title: 'Step Count',
  xLabel: '',                     // axis titles; empty means none
  yLabel: 'Step Count',
  points: [{ x: 0, y: 7440, group: 'Jay' }, ...],   // group sets the colour
  xTickLabels: { 0: 'Monday', ... },  // optional: words instead of numbers on the x-axis
  connectGroups: true,   // optional: draw a line through each group's points (line chart)
  showTrend: false,      // optional: draw the trend line and show r (scatter)
  showMeans: false,      // optional: draw an average bar at each x
  jitter: 0,             // optional: spread dots sideways a little (ignored when lines are on)
}
```

Each person gets a colour **and** a shape (circle, square, triangle…), so people
can still be told apart by anyone who has trouble seeing colours. A person keeps
the same colour and shape on all three charts.

**`src/stats.js`** (the maths):

- `linearFit` finds the straight line that best fits the dots (the dashed trend line).
- `pearson` gives **r**, from −1 to 1. Near 1 means the two go up together, near −1
  means one goes down as the other goes up, and near 0 means no clear link.

---

## Notes for the team

- **Changing how files are read** (what counts as valid, how blanks are handled) happens in `src/data.js`.
- **Changing how the charts look or behave** happens in `src/chart.js` and `styles.css`.
- **Changing which charts appear** or how they're labelled happens in `src/main.js`.
- **Adding an example:** put two CSVs in `data/examples/` and add a button in
  `index.html` with `data-a` and `data-b` pointing at them.
- **Type checking:** `main.js`, `chart.js` and `stats.js` start with `// @ts-check`, so
  VS Code underlines type mistakes as you type. From the terminal:
  `npx -p typescript tsc --noEmit --allowJs --target es2022 --module es2022 --moduleResolution bundler --lib es2022,dom,dom.iterable src/main.js src/chart.js src/stats.js`
  No output means no problems.
- **Deploying:** pushing to `main` deploys to GitHub Pages automatically
  (`.github/workflows/deploy.yml`).
