// @ts-check
/**
 * Entry point. Waits for the user to upload two CSVs, parses each with
 * data.js, then draws:
 *   1. a line chart of the first file (one line per group),
 *   2. a line chart of the second file,
 *   3. a scatter plot of the first file's values against the second's.
 * Nothing here assumes the files are steps or sleep; titles and axis labels
 * come from each file's top-left header.
 */
import { drawScatter } from './chart.js';
import { buildPlotData } from './data.js';

/** @typedef {import('./chart.js').PlotInput} PlotInput */
/** @typedef {import('./chart.js').ChartHandle} ChartHandle */
/** @typedef {import('./chart.js').RendererKind} RendererKind */
/** @typedef {ReturnType<typeof buildPlotData>} PlotData */

/**
 * Line chart input for one parsed file.
 * @param {PlotData} data
 * @param {string} fallbackName  used when the file has no top-left header
 * @returns {PlotInput}
 */
function toLineInput(data, fallbackName) {
  const name = data.valueHeader || fallbackName;
  return {
    title: name,
    xLabel: '',   // the file doesn't name its X axis; the tick labels (e.g. Monday) say enough
    yLabel: name,
    points: data.series.flatMap(({ group, points }) => points.map(([x, y]) => ({ x, y, group }))),
    xTickLabels: data.xTickLabels,
    connectGroups: true,
  };
}

/**
 * Scatter input: pairs each group's value in file A with its value in file B
 * for the same X header (e.g. Jay on Monday). Matching is by header text, not
 * position, because the two files may order their columns differently.
 * @param {PlotData} a  plotted on the Y axis
 * @param {PlotData} b  plotted on the X axis
 * @returns {PlotInput}
 */
function toScatterInput(a, b) {
  const nameA = a.valueHeader || 'File 1';
  const nameB = b.valueHeader || 'File 2';
  /** @param {PlotData} data @param {string} group @param {number} x */
  const key = (data, group, x) => JSON.stringify([group, data.xTickLabels?.[x] ?? x]);

  /** @type {Map<string, number>} */
  const bValues = new Map();
  for (const { group, points } of b.series) {
    for (const [x, y] of points) bValues.set(key(b, group, x), y);
  }

  const points = a.series.flatMap(({ group, points: pts }) => pts.flatMap(([x, y]) => {
    const other = bValues.get(key(a, group, x));
    return other === undefined ? [] : [{ x: other, y, group }];
  }));

  return { title: `${nameA} vs. ${nameB}`, xLabel: nameB, yLabel: nameA, points, showTrend: true };
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

// ---- Upload handling ------------------------------------------------------

const fileInputA = /** @type {HTMLInputElement} */ (byId('file-a'));
const fileInputB = /** @type {HTMLInputElement} */ (byId('file-b'));
const statusEl = byId('status');
const chartsEl = byId('charts');
const warningsEl = byId('warnings');

/** @type {string[]} warnings about the uploaded files */
let dataWarnings = [];
/** @type {Map<string, string>} chart title -> note about points a log axis can't show */
const scaleWarnings = new Map();
/** @type {ChartHandle[]} */
let chartHandles = [];
/** @type {RendererKind} */
let renderer = 'canvas';

function refreshWarnings() {
  showWarnings([...dataWarnings, ...scaleWarnings.values()]);
}

/** @param {string[]} messages */
function showWarnings(messages) {
  warningsEl.replaceChildren(...messages.map((m) => {
    const li = document.createElement('li');
    li.textContent = m; // textContent: messages can echo text from the user's files
    return li;
  }));
  warningsEl.hidden = messages.length === 0;
}

/**
 * Parse two CSV texts and draw the three charts (or explain what's wrong).
 * @param {string} textA  first file, plotted on Y in the scatter
 * @param {string} nameA
 * @param {string} textB  second file, plotted on X in the scatter
 * @param {string} nameB
 */
function showCharts(textA, nameA, textB, nameB) {
  const a = buildPlotData(textA);
  const b = buildPlotData(textB);
  dataWarnings = [
    ...a.warnings.map((message) => `${nameA}: ${message}`),
    ...b.warnings.map((message) => `${nameB}: ${message}`),
  ];
  scaleWarnings.clear();
  refreshWarnings();

  if (a.series.length === 0 || b.series.length === 0) {
    chartsEl.hidden = true; // don't leave the previous charts on screen
    statusEl.textContent = 'One of the files has no usable data. See the messages below.';
    return;
  }

  const scatter = toScatterInput(a, b);
  chartsEl.hidden = false; // show before drawing so the charts can measure their width
  chartHandles = [
    plotChart('chart-a', toLineInput(a, nameA)),
    plotChart('chart-b', toLineInput(b, nameB)),
    plotChart('chart-scatter', scatter),
  ];

  const groups = new Set([...a.series, ...b.series].map((s) => s.group)).size;
  statusEl.textContent = `Showing ${nameA} and ${nameB}: ${groups} groups, `
    + `${scatter.points.length} matched pairs on the scatter plot.`;
}

/**
 * Draw one chart with the current renderer, and surface any points that a
 * log axis can't show in the warnings list.
 * @param {string} id
 * @param {PlotInput} input
 */
function plotChart(id, input) {
  return drawScatter(byId(id), input, {
    renderer,
    onHidden(count) {
      if (count > 0) {
        scaleWarnings.set(id, `${input.title}: ${count} point${count === 1 ? '' : 's'} with a value of 0 or less can't be shown on a log axis.`);
      } else {
        scaleWarnings.delete(id);
      }
      refreshWarnings();
    },
  });
}

// ---- Renderer toggle (Canvas / SVG) ----------------------------------------

for (const button of document.querySelectorAll('button[data-renderer]')) {
  button.addEventListener('click', () => {
    renderer = /** @type {RendererKind} */ (button.getAttribute('data-renderer'));
    for (const b of document.querySelectorAll('button[data-renderer]')) {
      b.setAttribute('aria-pressed', String(b === button));
    }
    for (const handle of chartHandles) handle.setRenderer(renderer);
  });
}

/** @param {unknown} err */
function showError(err) {
  chartsEl.hidden = true;
  chartHandles = [];
  showWarnings([`Couldn't read the files: ${err instanceof Error ? err.message : String(err)}`]);
  statusEl.textContent = 'Something went wrong reading the files. See the message below.';
}

async function onFilesChanged() {
  const fileA = fileInputA.files?.[0];
  const fileB = fileInputB.files?.[0];
  if (!fileA || !fileB) {
    statusEl.textContent = 'Now pick the other file to see the charts.';
    return;
  }
  try {
    showCharts(await fileA.text(), fileA.name, await fileB.text(), fileB.name);
  } catch (err) {
    showError(err);
  }
}

fileInputA.addEventListener('change', onFilesChanged);
fileInputB.addEventListener('change', onFilesChanged);

// ---- Example buttons ------------------------------------------------------
// Each button names two CSV files in data/ (data-a and data-b attributes).

/** @param {string} path */
async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} could not be loaded (${res.status})`);
  return res.text();
}

for (const button of document.querySelectorAll('button[data-a][data-b]')) {
  button.addEventListener('click', async () => {
    const pathA = button.getAttribute('data-a') ?? '';
    const pathB = button.getAttribute('data-b') ?? '';
    // Clear any uploaded files so the pickers don't disagree with the charts.
    fileInputA.value = '';
    fileInputB.value = '';
    try {
      const [textA, textB] = await Promise.all([fetchText(pathA), fetchText(pathB)]);
      showCharts(textA, pathA.split('/').pop() ?? pathA, textB, pathB.split('/').pop() ?? pathB);
    } catch (err) {
      showError(err);
    }
  });
}
