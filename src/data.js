import Papa from 'papaparse';

const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Read a header-based CSV without guessing types or changing cell contents.
 * Column names are trimmed and must be nonempty and unique (case-sensitive).
 * Rows contain strings in column order, allowing a UI to offer column selectors.
 * @param {string} text
 * @returns {{columns: string[], rows: string[][], warnings: string[]}}
 */
export function parseCsv(text) {
  const warnings = [];
  const empty = () => ({ columns: [], rows: [], warnings });
  if (typeof text !== 'string') {
    warnings.push('CSV input must be text');
    return empty();
  }
  // Keep record indexes intact so warnings refer to the original CSV records.
  const { data, errors } = Papa.parse(text, { delimiter: ',' });
  const invalidRows = new Set(errors.map(error => error.row));
  warnings.push(...errors.map(error => `CSV record ${error.row + 1} skipped: ${error.message}`));
  const columns = data[0]?.map(value => value.trim());
  if (invalidRows.has(0) || !columns || columns.some(column => !column) ||
      new Set(columns).size !== columns.length) {
    warnings.push('CSV must have a header with nonempty, unique column names');
    return empty();
  }
  const rows = [];
  data.slice(1).forEach((fields, index) => {
    if (invalidRows.has(index + 1) || fields.every(value => !value.trim())) return;
    if (fields.length !== columns.length) {
      warnings.push(`CSV record ${index + 2} skipped: wrong number of fields`);
      return;
    }
    rows.push(fields);
  });
  return { columns, rows, warnings };
}

/**
 * The first header describes the value semantics (e.g. steps), the first column holds
 * groups (e.g. person), and remaining headers are X values (e.g. weekday).
 * Y is numeric; X type is selected by the caller. Group labels preserve case and are trimmed.
 * Series are sorted by group name and their points by X for line chart renderers.
 * Each series owns its group label; its points are [x, y] arrays.
 * valueHeader preserves the top-left header. Categorical X text is preserved
 * in xTickLabels. Repeated group rows are combined without aggregation.
 * Returns warnings rather than throwing for invalid CSV or column selections.
 * @param {string} text
 * @param {{xColumns?: string[],
 *   xType?: 'number' | 'category'}} [options]
 * @returns {{series: {group: string, points: [number, number][]}[],
 *   valueHeader: string | null, xType: 'number' | 'category',
 *   xTickLabels?: Record<number, string>, warnings: string[]}}
 */
export function buildPlotData(text, options) {
  const { columns, rows, warnings } = parseCsv(text);
  const { xColumns = columns.slice(1), xType = 'category' } = options ?? {};
  const result = {
    valueHeader: columns[0] ?? null,
    xType,
    ...(xType === 'category' ? { xTickLabels: {} } : {}),
    series: [], warnings,
  };
  if (!columns.length) return result;
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
  const counts = new Map();
  const skip = reason => counts.set(reason, (counts.get(reason) || 0) + 1);
  for (const fields of rows) {
    const group = fields[0].trim();
    for (const { column, x } of axes) {
      if (!group) { skip('group was blank'); continue; }
      const rawY = fields[column].trim();
      if (!rawY) { skip('Y was blank'); continue; }
      const y = Number(rawY);
      if (!numericPattern.test(rawY) || !Number.isFinite(y)) {
        skip('Y was not a finite number'); continue;
      }
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([x, y]);
    }
  }
  result.series = [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([group, points]) => ({ group, points: points.sort((a, b) => a[0] - b[0]) }));
  for (const [reason, count] of counts) {
    warnings.push(`${count} ${count === 1 ? 'observation' : 'observations'} skipped: ${reason}`);
  }
  return result;
}

// File access runs only when this module is Node's entry point.
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
  for (const warning of result.warnings) console.log(`  ${warning}`);
  console.log(`Full plot data written to ${fileURLToPath(output)}`);
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
