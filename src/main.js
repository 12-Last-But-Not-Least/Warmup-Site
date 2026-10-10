// @ts-check
/**
 * Entry point. Waits for the user to upload both CSVs, parses them with
 * data.js, then shows the three scatter plots.
 */
import { drawScatter } from './chart.js';
import { buildRows } from './data.js';

/** @typedef {import('./chart.js').PlotInput} PlotInput */

/**
 * Shape we expect from preprocessing: one row per person per weekday.
 * @typedef {Object} DayRow
 * @property {string} person
 * @property {number} weekday     0=Mon ... 6=Sun
 * @property {number} steps
 * @property {number} sleepHours
 */

const WEEKDAYS = { 0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun' };

/**
 * The three PlotInputs, built from preprocessed rows.
 * @param {DayRow[]} rows
 * @returns {PlotInput[]}
 */
function toPlotInputs(rows) {
  return [
    {
      title: 'Steps by weekday',
      xLabel: 'Weekday',
      yLabel: 'Steps',
      points: rows.map((r) => ({ x: r.weekday, y: r.steps, group: r.person })),
      xTickLabels: WEEKDAYS,
      jitter: 0.15,
      showMeans: true,
    },
    {
      title: 'Sleep by weekday',
      xLabel: 'Weekday',
      yLabel: 'Sleep (hours)',
      points: rows.map((r) => ({ x: r.weekday, y: r.sleepHours, group: r.person })),
      xTickLabels: WEEKDAYS,
      jitter: 0.15,
      showMeans: true,
    },
    {
      title: 'Steps vs. sleep',
      xLabel: 'Sleep (hours)',
      yLabel: 'Steps',
      points: rows.map((r) => ({ x: r.sleepHours, y: r.steps, group: r.person })),
      showTrend: true,
    },
  ];
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

const CHART_IDS = ['chart-weekday-steps', 'chart-weekday-sleep', 'chart-sleep-steps'];

/** @param {DayRow[]} rows */
function drawAll(rows) {
  toPlotInputs(rows).forEach((input, i) => drawScatter(byId(CHART_IDS[i]), input));
}

// ---- Upload handling ------------------------------------------------------

const stepsInput = /** @type {HTMLInputElement} */ (byId('steps-file'));
const sleepInput = /** @type {HTMLInputElement} */ (byId('sleep-file'));
const statusEl = byId('status');
const chartsEl = byId('charts');
const warningsEl = byId('warnings');

/** @param {string[]} messages */
function showWarnings(messages) {
  warningsEl.replaceChildren(...messages.map((m) => {
    const li = document.createElement('li');
    li.textContent = m; // textContent: messages can echo text from the user's files
    return li;
  }));
  warningsEl.hidden = messages.length === 0;
}

async function onFilesChanged() {
  const stepsFile = stepsInput.files?.[0];
  const sleepFile = sleepInput.files?.[0];
  if (!stepsFile || !sleepFile) {
    statusEl.textContent = 'Now pick the other file to see the charts.';
    return;
  }

  try {
    const { rows, warnings } = buildRows(await stepsFile.text(), await sleepFile.text());
    showWarnings(warnings);
    if (rows.length === 0) {
      chartsEl.hidden = true; // don't leave the previous upload's charts on screen
      statusEl.textContent = 'No rows matched in both files. See the messages below.';
      return;
    }
    chartsEl.hidden = false; // show before drawing so the charts can measure their width
    drawAll(rows);
    const people = new Set(rows.map((r) => r.person)).size;
    statusEl.textContent = `Showing ${stepsFile.name} and ${sleepFile.name}: ${rows.length} days from ${people} people.`;
  } catch (err) {
    chartsEl.hidden = true;
    showWarnings([`Couldn't read the files: ${err instanceof Error ? err.message : String(err)}`]);
    statusEl.textContent = 'Something went wrong reading the files. See the message below.';
  }
}

stepsInput.addEventListener('change', onFilesChanged);
sleepInput.addEventListener('change', onFilesChanged);
