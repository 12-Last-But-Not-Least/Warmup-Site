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

**What happens to problems in the files:**

- **Blank cells** are skipped, so they don't show up as zeros. The page says how many.
- **Text where a number should be** is skipped the same way.
- **A file with a broken header** (empty or repeated column names) shows a message
  explaining what's wrong, and no charts appear.

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
const { series, valueHeader, xTickLabels, warnings } = buildPlotData(csvText);
```

- `series`: one entry per person, e.g. `{ group: 'Jay', points: [[0, 7440], [1, 10560], ...] }`.
  The first number in each point is the column position (0 = first column after the names).
- `valueHeader`: the top-left cell, e.g. `'Step Count'`.
- `xTickLabels`: column names by position, e.g. `{ 0: 'Monday', 1: 'Tuesday', ... }`.
- `warnings`: plain-English messages about anything skipped.

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

## End-to-end tests

These tests open the site in a real browser (Chromium) and use it the way a person
would: clicking the example buttons, uploading files, hovering, zooming, and so on.

**First time only:**

```sh
npm install
npx playwright install chromium
```

**Run the tests:**

```sh
npm run test:e2e
```

They start the site on their own (no need for `npm start`) and take about 10 seconds.
The site loads Papa Parse from a CDN, so you need an internet connection.

**If a test fails,** run `npx playwright show-report`. It opens a page with a
screenshot and a step-by-step replay of each failure.

**What they check** (all in `e2e/site.spec.mjs`):

- **First visit:** the upload panel shows and the charts are hidden.
- **Example buttons:** each one draws two line charts and a scatter plot with the right
  titles, number of lines, number of points and r value.
- **Uploading:**
  - the team's data files work, and skipped blank cells are reported;
  - picking one file asks for the other;
  - files with columns in a different order still pair up;
  - bad files (empty, repeated column names, no numbers) show a message instead of
    charts, and a bad file after a good one hides the old charts;
  - names from a file are shown as text, never run as code.
- **Charts:** tooltips, hiding and highlighting people from the legend, zoom, pan,
  Reset view, and the data table.
- **Phones:** the page fits a 375px-wide screen without sideways scrolling.

The tests also fail if the page hits a JavaScript error or a missing file (404).

**Known bug:** a CSV with a header but no data rows says "See the messages below" but
shows no message. That test is marked as expected to fail until `feature/csv-validation`
is merged. After that, Playwright reports it as "expected to fail, but passed"; delete
the `test.fail(...)` line in the test file (marked TODO).

**On GitHub:** the team's CI workflow (`.github/workflows/ci.yml`, issue #14) runs
`npm run test:e2e` on every pull request. If the tests fail, the report is attached to the run.

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
