/**
 * CSV parsing, validation, and conversion to plot data.
 * @module data
 */
import Papa from 'papaparse';

const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Parse CSV with Papa Parse and validate the project's metric/category layout.
 * Record numbers include the header; quoted multiline fields remain one record.
 * Invalid numeric cells become empty strings, never zero.
 * Callers must check errors before using the returned rows.
 * @param {unknown} text - CSV input; non-string or blank input produces a validation error.
 * @returns {{columns: string[], rows: string[][], errors: string[], warnings: string[]}} Trimmed column names and rows, blocking errors, and warnings about skipped rows or invalid cells.
 */
export function parseCsv(text) {
  const result = { columns: [], rows: [], errors: [], warnings: [] };
  const { errors, warnings } = result;
  if (typeof text !== 'string' || !text.trim()) {
    errors.push('CSV input must be nonempty text');
    return result;
  }
  const parsed = Papa.parse(text, {
    delimiter: ',', header: false, dynamicTyping: false, skipEmptyLines: false,
  });
  for (const error of parsed.errors) {
    const location = Number.isInteger(error.row) ? ` record ${error.row + 1}` : '';
    errors.push(`CSV${location}: ${error.message}`);
  }
  if (errors.length) return result;
  const columns = parsed.data[0].map(value => value.trim());
  if (columns.some(column => !column) || new Set(columns).size !== columns.length) {
    errors.push('CSV header must have nonempty, unique column names');
  }
  if (columns.length < 2) errors.push('CSV needs a metric name and at least one category column');
  if (errors.length) return result;
  result.columns = columns;
  const groups = new Set();
  let observations = 0;
  parsed.data.slice(1).forEach((fields, index) => {
    const record = index + 2;
    if (fields.every(value => !value.trim())) return;
    if (fields.length !== columns.length) {
      warnings.push(`CSV record ${record} skipped: expected ${columns.length} fields, found ${fields.length}`);
      return;
    }
    const group = fields[0].trim();
    if (!group) {
      warnings.push(`CSV record ${record}, column 1 skipped: group name is blank`);
      return;
    }
    if (groups.has(group)) {
      errors.push(`CSV record ${record}, column 1: duplicate group "${group}"`);
      return;
    }
    groups.add(group);
    const row = [group];
    for (let column = 1; column < columns.length; column++) {
      const value = fields[column].trim();
      if (!value || !numericPattern.test(value) || !Number.isFinite(Number(value))) {
        warnings.push(`CSV record ${record}, column ${column + 1} ("${columns[column]}") skipped: ${value ? 'value is not a finite number' : 'value is blank'}`);
        row.push('');
      } else {
        row.push(value);
        observations++;
      }
    }
    result.rows.push(row);
  });
  if (!observations) errors.push('CSV has no usable numeric observations');
  return result;
}

/**
 * One group's observations.
 * @typedef {Object} PlotSeries
 * @property {string} group - Group name.
 * @property {number[][]} points - Numeric pairs, each ordered as [x, y].
 */

/**
 * Parsed CSV data prepared for plotting.
 * @typedef {Object} PlotData
 * @property {PlotSeries[]} series - Groups and their observations.
 * @property {string|null} valueHeader - Top-left CSV header, or null if unavailable.
 * @property {('number'|'category')} xType - Type of the X axis.
 * @property {Object<number, string>} [xTickLabels] - Category labels by X position.
 * @property {string[]} errors - Blocking validation errors.
 * @property {string[]} warnings - Messages about skipped data or invalid options.
 */

/**
 * The first header describes the value semantics (e.g. steps), the first column holds
 * groups (e.g. person), and remaining headers are X values (e.g. weekday).
 * Y is numeric; X type is selected by the caller. Group labels preserve case and are trimmed.
 * Series are sorted by group name and their points by X for line chart renderers.
 * Each series owns its group label; its points are [x, y] arrays.
 * valueHeader preserves the top-left header. Categorical X text is preserved
 * in xTickLabels. Duplicate group rows are rejected.
 * Returns errors and warnings rather than throwing for invalid input.
 * @param {string} text - CSV text to parse.
 * @param {Object} [options] - Plot configuration.
 * @param {string[]} [options.xColumns] - Selected X headers; defaults to all headers after the first.
 * @param {('number'|'category')} [options.xType='category'] - Type of the X axis.
 * @returns {PlotData} Parsed series, labels, errors, and warnings.
 */
export function buildPlotData(text, options) {
  const { columns, rows, errors, warnings } = parseCsv(text);
  const { xColumns = columns.slice(1), xType = 'category' } = options ?? {};
  const result = {
    valueHeader: columns[0] ?? null,
    xType,
    ...(xType === 'category' ? { xTickLabels: {} } : {}),
    series: [], errors, warnings,
  };
  if (errors.length) return result;
  if (!['number', 'category'].includes(xType)) warnings.push('X type must be number or category');
  const validHeaders = Array.isArray(xColumns) && xColumns.length > 0 &&
    new Set(xColumns).size === xColumns.length &&
    xColumns.every(header => columns.indexOf(header) > 0);
  if (!validHeaders) warnings.push('Select unique existing X headers after the first column');
  if (!validHeaders || !['number', 'category'].includes(xType)) return result;

  // Resolve X once per selected header, rather than once per data cell.
  const axes = [];
  xColumns.forEach((header, index) => {
    const x = xType === 'category' ? index : Number(header);
    if (xType === 'number' && (!numericPattern.test(header) || !Number.isFinite(x))) {
      warnings.push(`X header "${header}" skipped: not a finite number`);
      return;
    }
    if (xType === 'category') result.xTickLabels[x] = header;
    axes.push({ column: columns.indexOf(header), x });
  });
  const groups = new Map();
  for (const fields of rows) {
    const group = fields[0].trim();
    for (const { column, x } of axes) {
      const rawY = fields[column].trim();
      if (!rawY) continue;
      const y = Number(rawY);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([x, y]);
    }
  }
  result.series = [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([group, points]) => ({ group, points: points.sort((a, b) => a[0] - b[0]) }));
  return result;
}

/**
 * Parse the bundled step-count CSV and write the result to data/result.json.
 * Runs only when this module is Node's entry point.
 * Logs observation counts and validation messages; validation errors set exit code 1.
 * @returns {Promise<void>} Resolves after writing the JSON output and logging the result.
 * @throws {Error} Rejects if reading the CSV or writing the JSON file fails.
 */
async function main() {
  const { readFile, writeFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const text = await readFile(new URL('../data/DATA - Step Count.csv', import.meta.url), 'utf8');
  // Select only headers that exist in the raw file; no semantic renaming.
  const result = buildPlotData(text);
  const output = new URL('../data/result.json', import.meta.url);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
  const pointCount = result.series.reduce((count, series) => count + series.points.length, 0);
  console.log(`${pointCount} points across ${result.series.length} groups`);
  for (const error of result.errors) console.error(`  ${error}`);
  if (result.errors.length) process.exitCode = 1;
  for (const warning of result.warnings) console.log(`  ${warning}`);
  console.log(`Full plot data written to ${fileURLToPath(output)}`);
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
