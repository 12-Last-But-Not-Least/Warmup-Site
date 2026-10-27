// @ts-check
/**
 * Turns parsed CSV data (data.js) into the input shape the chart library expects.
 * Pure functions, kept apart from main.js so they can be tested without a DOM.
 */

/** @typedef {import('./chart.js').PlotInput} PlotInput */
/** @typedef {ReturnType<typeof import('./data.js').buildPlotData>} PlotData */

/**
 * Line chart input for one parsed file.
 * @param {PlotData} data
 * @param {string} fallbackName  used when the file has no top-left header
 * @returns {PlotInput}
 */
export function toLineInput(data, fallbackName) {
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
export function toScatterInput(a, b) {
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
