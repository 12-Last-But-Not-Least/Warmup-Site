// @ts-check
/**
 * Entry point. Waits for the user to upload two CSVs, parses each with
 * data.js, then draws:
 *   1. a line chart of the first file (one line per group),
 *   2. a line chart of the second file,
 *   3. a scatter plot of the first file's values against the second's.
 * Nothing here assumes the files are steps or sleep; titles and axis labels
 * come from each file's top-left header.
 * @module main
 */
import { drawScatter } from './chart.js';
import { buildPlotData } from './data.js';

/** @import { PlotInput } from './chart.js' */
/** @import { PlotData } from './data.js' */

/**
 * Convert one parsed file into a chart configuration with connected group lines.
 * @param {PlotData} data - Parsed groups, observations, and category labels.
 * @param {string} fallbackName - Chart title and Y-axis label used when the value header is empty.
 * @returns {PlotInput} Line chart settings with one point per observation and lines connecting each group.
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
 * Observations without a matching group and category in the other file are omitted.
 * @param {PlotData} a - First file's observations, plotted on the Y axis.
 * @param {PlotData} b - Second file's observations, plotted on the X axis.
 * @returns {PlotInput} Matched scatter points, axis labels, and settings enabling the trend line.
 */
function toScatterInput(a, b) {
  const nameA = a.valueHeader || 'File 1';
  const nameB = b.valueHeader || 'File 2';
  /**
   * Identify an observation by its group and category label, or numeric X value.
   * @param {PlotData} data - Parsed data supplying the category labels.
   * @param {string} group - Group name to match across files.
   * @param {number} x - X coordinate whose label or value identifies the category.
   * @returns {string} JSON-encoded group and category pair used as a lookup key.
   */
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
 * Find a required HTML element by its ID.
 * @param {string} id - Element ID without the leading hash character.
 * @returns {HTMLElement} The matching element.
 * @throws {Error} If no element with the supplied ID exists in the page.
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

/**
 * Replace the warning list with plain-text messages and hide it when empty.
 * @param {string[]} messages - Validation or file-loading messages to display.
 * @returns {void} Updates the warning list in the page.
 */
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
 * Hides the charts if either file has blocking errors or no usable series.
 * Reports a warning if the files have no matching scatter observations.
 * @param {string} textA - First CSV's contents, plotted on the scatter plot's Y axis.
 * @param {string} nameA - First file's display name for messages and fallback labels.
 * @param {string} textB - Second CSV's contents, plotted on the scatter plot's X axis.
 * @param {string} nameB - Second file's display name for messages and fallback labels.
 * @returns {void} Updates the charts, warnings, and status message.
 */
function showCharts(textA, nameA, textB, nameB) {
  const a = buildPlotData(textA);
  const b = buildPlotData(textB);
  const messages = [
    ...a.errors.map((message) => `${nameA}: Error: ${message}`),
    ...b.errors.map((message) => `${nameB}: Error: ${message}`),
    ...a.warnings.map((message) => `${nameA}: ${message}`),
    ...b.warnings.map((message) => `${nameB}: ${message}`),
  ];
  showWarnings(messages);

  if (a.errors.length || b.errors.length || a.series.length === 0 || b.series.length === 0) {
    chartsEl.hidden = true; // don't leave the previous charts on screen
    statusEl.textContent = 'One of the files failed validation or has no usable data. See the messages below.';
    return;
  }

  const scatter = toScatterInput(a, b);
  if (!scatter.points.length) {
    showWarnings([...messages, 'No matching numeric observations: the files must share a person and category to populate the scatter plot.']);
  }
  chartsEl.hidden = false; // show before drawing so the charts can measure their width
  drawScatter(byId('chart-a'), toLineInput(a, nameA));
  drawScatter(byId('chart-b'), toLineInput(b, nameB));
  drawScatter(byId('chart-scatter'), scatter);

  const groups = new Set([...a.series, ...b.series].map((s) => s.group)).size;
  statusEl.textContent = `Showing ${nameA} and ${nameB}: ${groups} groups, `
    + `${scatter.points.length} matched pairs on the scatter plot.`;
}

/**
 * Hide the charts and display a file-loading error.
 * @param {unknown} err - Error or other thrown value to convert into a user-facing message.
 * @returns {void} Updates chart visibility, warnings, and status text.
 */
function showError(err) {
  chartsEl.hidden = true;
  showWarnings([`Couldn't read the files: ${err instanceof Error ? err.message : String(err)}`]);
  statusEl.textContent = 'Something went wrong reading the files. See the message below.';
}

/**
 * Read the selected CSV files and display their charts when both are available.
 * Prompts for the other file when only one is selected and displays read failures.
 * @returns {Promise<void>} Resolves after updating the page for the current selection.
 */
async function onFilesChanged() {
  const fileA = fileInputA.files?.[0];
  const fileB = fileInputB.files?.[0];
  if (!fileA || !fileB) {
    chartsEl.hidden = true;
    showWarnings([]);
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

/**
 * Fetch an example CSV file as text.
 * @param {string} path - URL or relative path of the CSV file to load.
 * @returns {Promise<string>} Resolves to the response body as text.
 * @throws {Error} Rejects if fetching or reading the response fails, or the HTTP status is unsuccessful.
 */
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
