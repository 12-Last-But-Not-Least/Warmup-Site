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
| Switch between Canvas and SVG drawing | Use the **Render charts with** buttons above the charts; they stay in view as you scroll (Canvas is the default) |
| Use a log scale | Pick **Log** in a chart's **Y scale** (or **X scale**) menu. Each axis is set separately |

**About log scale:** a log axis can't show 0 or negative numbers. Those points are
hidden, and the page tells you how many. The line charts have weekday names along
the bottom, so they only offer a log scale for the Y axis.

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
  chart.js          builds each chart (ticks, points, hover, zoom, legend) and hands it to a renderer
  scales.js         linear and log scales and axis ticks (no browser code, so it's unit-tested)
  render-common.js  what both renderers share: the chart "scene" format and marker shapes
  render-canvas.js  draws a scene with HTML5 canvas (the default)
  render-svg.js     draws a scene as SVG
  stats.js          the maths for the trend line and r, and a hook for swapping in another stats library
test/
  scales.test.js    tests for scales, ticks and the stats hook (`npm test`)
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
chart.js    works out where everything goes (a "scene" of pixel positions)
      │
      ▼
render-canvas.js  or  render-svg.js    paint the scene
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
const chart = drawScatter(whereToDraw, chartDescription, options);
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

The optional third argument and the returned handle control the new settings:

```js
const chart = drawScatter(whereToDraw, chartDescription, {
  renderer: 'canvas',   // 'canvas' (default) or 'svg'
  xScale: 'linear',     // 'linear' (default) or 'log'
  yScale: 'linear',
  controls: true,       // false hides the Linear/Log menus so you can build your own
  onHidden: (n) => {},  // called with how many points a log axis can't show (value of 0 or less)
});

chart.setRenderer('svg');     // switch live; the current zoom is kept
chart.setScale('y', 'log');   // per axis; that axis goes back to its full view
chart.getState();             // { renderer, xScale, yScale, hidden }
```

Both renderers draw the same scene and read the same CSS colour variables, so
hover, zoom, pan and light/dark mode behave the same either way. `main.js` has the
Canvas/SVG buttons and shows the `onHidden` counts in the warnings list.

Each person gets a colour **and** a shape (circle, square, triangle…), so people
can still be told apart by anyone who has trouble seeing colours. A person keeps
the same colour and shape on all three charts.

**`src/stats.js`** (the maths):

- `linearFit` finds the straight line that best fits the dots (the dashed trend line).
- `pearson` gives **r**, from −1 to 1. Near 1 means the two go up together, near −1
  means one goes down as the other goes up, and near 0 means no clear link.

**Plugging in another stats library.** The chart gets its numbers from
`computeStats(points)`. To use a different implementation, register it once:

```js
import { setStatsProvider } from './stats.js';

setStatsProvider((points) => ({   // points: [{ x, y }, ...] currently on the chart
  n, r, slope, intercept,         // required; use NaN (don't throw) when undefined
  r_squared, p_value,             // optional; p_value is added to the r label in the legend
}));
setStatsProvider();               // go back to the built-in version
```

The field names match `correlation_stats()` in `Warm_up_project/stats.py`. The
provider has to answer immediately (it can't be `async`), so calling that Python
code through an API would need an extra step that doesn't exist yet.

---

## Notes for the team

- **Changing how files are read** (what counts as valid, how blanks are handled) happens in `src/data.js`.
- **Changing how the charts look or behave** happens in `src/chart.js` and `styles.css`.
- **Changing which charts appear** or how they're labelled happens in `src/main.js`.
- **Tests:** `npm test` runs the scale, tick and stats-hook tests in `test/`.
- **Adding an example:** put two CSVs in `data/examples/` and add a button in
  `index.html` with `data-a` and `data-b` pointing at them.
- **Type checking:** The files in `src/` start with `// @ts-check`, so
  VS Code underlines type mistakes as you type. From the terminal:
  `npx -p typescript tsc --noEmit --allowJs --target es2022 --module es2022 --moduleResolution bundler --lib es2022,dom,dom.iterable src/main.js`
  No output means no problems.
- **Deploying:** pushing to `main` deploys to GitHub Pages automatically
  (`.github/workflows/deploy.yml`).
