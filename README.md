# Steps & Sleep

A small website where you upload two spreadsheets, one with daily step counts and
one with hours of sleep, and get three interactive charts:

1. **Steps by weekday:** each person's steps for each day of the week, plus the average for each day.
2. **Sleep by weekday:** the same, for hours of sleep.
3. **Steps vs. sleep:** one dot per person per day, with a trend line and a number (r)
   showing how strongly sleep and steps move together.

Everything runs in the browser. The files you upload are never sent anywhere.

---

## How to run it

You need [Node.js](https://nodejs.org) installed, but only to start a small local
web server. There is nothing to install or build.

```sh
cd scatter-app
npx serve
```

Open the link it prints (usually http://localhost:3000).

> Double-clicking `index.html` won't work. Browsers block this kind of JavaScript
> when a page is opened straight from your disk, so it has to come from a server,
> even a local one.

---

## How to use it

1. Click **Steps CSV** and pick the steps file.
2. Click **Sleep CSV** and pick the sleep file.
3. The charts appear. The line under the title tells you how many days and people were loaded.

You can try it with the two example files in the `data/` folder.

**On the charts:**

| To do this | Do this |
|---|---|
| See exact values | Hover over a dot (or an average bar) |
| Focus on one person | Hover over their name in the legend |
| Hide or show a person | Click their name in the legend |
| Zoom in or out | Hold Ctrl (or ⌘ on a Mac) and scroll, or pinch on a trackpad |
| Move around | Click and drag |
| Go back to the full view | Double-click the chart, or press **Reset view** |
| See the raw numbers | Open **Show data table** under a chart |

---

## What the files should look like

Use the spreadsheets exactly as they come out of Google Sheets
(**File → Download → CSV**). One person per row, then a column for each day:

```
Step Count,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday
Eita,3608,4246,4116,5500,4207,3590,4563
Jay,7440,10560,6566,9767,3235,5623,2404
```

```
Hours of Sleep,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday
Eita,6.839,6.621,6.993,5.989,6.143,6.022,6.212
Jay,9,8.4,7.6,8,9.5,9,8
```

- **First column:** the person's name. The heading above it can say anything.
- **Next seven columns:** Monday to Sunday, in any order.
- **Steps:** whole numbers, zero or more.
- **Sleep:** hours between 0 and 24. Decimals are fine.
- **Names:** extra spaces and capital letters don't matter. `jay ` and `Jay` count as the same person.

**What happens to problems in the files:**

- **Blank cells** are skipped, so they don't show up as zeros on the charts.
  The page tells you how many were skipped.
- **Text where a number should be,** or impossible values like 30 hours of sleep,
  are skipped the same way and listed under the upload buttons.
- **A day that's only in one file** (steps but no sleep, or the other way round) is left out.
- **A file in the wrong layout** shows a message explaining what was expected, and no charts appear.

---

## What's inside

```
scatter-app/
  index.html        the page: title, the two upload buttons, spaces for the charts
  styles.css        colours, fonts, layout, light and dark mode
  src/
    main.js         connects everything: reads the uploads, prepares the data, draws the charts
    data.js         reads the CSV files and turns them into clean rows
    chart.js        draws the charts (written from scratch, no chart library)
    stats.js        the maths for the trend line and r
  data/
    DATA - Step Count.csv       example files to try uploading
    DATA - Hours of Sleep.csv
```

### How the pieces fit together

```
your two CSV files
      │
      ▼
data.js     reads both files, checks every value, matches each person's
            steps and sleep for the same day
      │     → a list of rows like { person: "Jay", weekday: 0, steps: 7440, sleepHours: 9 }
      ▼
main.js     turns those rows into three chart descriptions
            (title, axis labels, which value goes on which axis)
      │
      ▼
chart.js    draws each chart on the page
```

Weekdays are stored as numbers: **0 = Monday … 6 = Sunday.**

### Each file in a bit more detail

**`src/data.js`** (CSV reading). Exports one function:

```js
const { rows, warnings } = buildRows(stepsFileText, sleepFileText);
```

- `rows` is one entry per person per day that appears in both files, sorted by name and then by day.
- `warnings` is a list of plain-English messages about anything that was skipped.
- It uses a library called [Papa Parse](https://www.papaparse.com/) to read CSV files
  correctly, including quoted text and different line endings.
  `index.html` loads Papa Parse from a CDN, which is why there's nothing to install.

**`src/main.js`** (the glue). Waits until both files are picked, calls `buildRows`,
shows any warnings, then asks `chart.js` to draw the three charts. It hides the
charts if the files can't be used.

**`src/chart.js`** (the charts). Exports one function:

```js
drawScatter(whereToDraw, chartDescription);
```

The same function draws all three charts. It doesn't know anything about steps or
sleep; it just plots the numbers it's given. A chart description looks like this:

```js
{
  title: 'Steps by weekday',
  xLabel: 'Weekday',
  yLabel: 'Steps',
  points: [{ x: 0, y: 7440, group: 'Jay' }, ...],   // group = whose dot it is (sets the colour)
  xTickLabels: { 0: 'Mon', 1: 'Tue', ..., 6: 'Sun' }, // optional: words instead of numbers on the x-axis
  jitter: 0.15,       // optional: spreads dots sideways a little so they don't hide each other
  showMeans: true,    // optional: draws the average bar for each day
  showTrend: false,   // optional: draws the trend line and shows r
}
```

Inside, it works out the axis ranges and tick marks, draws the dots, legend,
tooltip and data table, and handles zooming and dragging. Each person gets a
colour **and** a shape (circle, square, triangle…), so people can still be told
apart by anyone who has trouble seeing colours. A person keeps the same colour
and shape on all three charts.

**`src/stats.js`** (the maths). Two small functions:

- `linearFit` finds the straight line that best fits the dots (the dashed trend line).
- `pearson` gives **r**, a number from −1 to 1. Near 1 means more sleep goes with
  more steps, near −1 means the opposite, and near 0 means no clear link.

---

## Putting it online

The site is just files, with no server code and no build step, so any static host works:

- **GitHub Pages:** push this folder to a GitHub repo, then go to
  **Settings → Pages → Deploy from branch** and pick the main branch.
- **Netlify:** drag this folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

---

## Notes for the team

- **Changing the data rules** (what counts as valid, how blanks are handled) happens in `src/data.js`.
- **Changing how the charts look or behave** happens in `src/chart.js` and `styles.css`.
- **Changing which charts appear,** their titles or their options happens in `toPlotInputs()` in `src/main.js`.
- **Keep the row format the same:** `data.js` and `main.js` both rely on
  `{ person, weekday, steps, sleepHours }`. If it ever has to change,
  tell everyone first.
- **Type checking:** `main.js`, `chart.js` and `stats.js` start with `// @ts-check`, so
  VS Code underlines type mistakes as you type. To check them from the terminal:
  `npx -p typescript tsc --noEmit --allowJs --target es2022 --module es2022 --moduleResolution bundler --lib es2022,dom,dom.iterable src/main.js src/chart.js src/stats.js`
  No output means no problems. Only files that start with `// @ts-check` are checked.
  `data.js` doesn't have it yet, so it isn't checked. It still needs `// @ts-check` and JSDoc types.
