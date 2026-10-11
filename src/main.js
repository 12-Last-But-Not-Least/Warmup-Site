// @ts-check
/**
 * Entry point. Waits for the user to upload both CSVs, parses them with
 * data.js, then shows the three scatter plots.
 */
import { drawScatter } from './chart.js';
import { buildPlotData } from './data.js';

/** @typedef {import('./chart.js').PlotInput} PlotInput */

/**
 * Adapter for the existing charts: one matched row per group and X header.
 * @typedef {Object} DayRow
 * @property {string} person
 * @property {number} weekday     X position in the steps file
 * @property {number} steps
 * @property {number} sleepHours
 */

/**
 * The three PlotInputs, built from preprocessed rows.
 * @param {DayRow[]} rows
 * @param {Record<number, string>} [xTickLabels]
 * @returns {PlotInput[]}
 */
function toPlotInputs(rows, xTickLabels) {
  return [
    {
      title: 'Steps by weekday',
      xLabel: 'Weekday',
      yLabel: 'Steps',
      points: rows.map((r) => ({ x: r.weekday, y: r.steps, group: r.person })),
      xTickLabels,
      jitter: 0.15,
      showMeans: true,
    },
    {
      title: 'Sleep by weekday',
      xLabel: 'Weekday',
      yLabel: 'Sleep (hours)',
      points: rows.map((r) => ({ x: r.weekday, y: r.sleepHours, group: r.person })),
      xTickLabels,
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

/**
 * @param {DayRow[]} rows
 * @param {Record<number, string>} [xTickLabels]
 */
function drawAll(rows, xTickLabels) {
  toPlotInputs(rows, xTickLabels).forEach((input, i) => drawScatter(byId(CHART_IDS[i]), input));
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
    const steps = buildPlotData(await stepsFile.text());
    const sleep = buildPlotData(await sleepFile.text());
    // Match by raw header, not X index: the files may order headers differently.
    const sleepValues = new Map(sleep.series.flatMap(({ group, points }) =>
      points.map(([x, y]) => /** @type {[string, number]} */
        ([JSON.stringify([group, sleep.xTickLabels?.[x]]), y]))));
    /** @type {DayRow[]} */
    const rows = steps.series.flatMap(({ group, points }) => points.flatMap(([x, y]) => {
      const sleepHours = sleepValues.get(JSON.stringify([group, steps.xTickLabels?.[x]]));
      return sleepHours === undefined ? [] : [{ person: group, weekday: x, steps: y, sleepHours }];
    }));
    const warnings = [
      ...steps.warnings.map(message => `${stepsFile.name}: ${message}`),
      ...sleep.warnings.map(message => `${sleepFile.name}: ${message}`),
    ];
    showWarnings(warnings);
    if (rows.length === 0) {
      chartsEl.hidden = true; // don't leave the previous upload's charts on screen
      statusEl.textContent = 'No rows matched in both files. See the messages below.';
      return;
    }
    chartsEl.hidden = false; // show before drawing so the charts can measure their width
    drawAll(rows, steps.xTickLabels);
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
