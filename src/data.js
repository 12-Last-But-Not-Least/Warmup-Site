import Papa from './vendor/papa.js';

const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * The form of a group name used for matching, so "Jay", "jay" and " JAY "
 * count as the same person. Also ignores invisible characters, runs of
 * whitespace, and different encodings of accents.
 * @param {string} name
 * @returns {string}
 */
export function nameKey(name) {
  return name
    .normalize('NFC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Read a header-based CSV without guessing types or changing cell contents.
 * Column names are trimmed and must be nonempty and unique (case-sensitive).
 * Rows contain strings in column order, allowing a UI to offer column selectors.
 * @param {string} text
 * @returns {{columns: string[], rows: string[][], recordNumbers: number[], warnings: string[]}}
 */
export function parseCsv(text) {
  const warnings = [];
  const empty = () => ({ columns: [], rows: [], recordNumbers: [], warnings });
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
  const recordNumbers = [];
  data.slice(1).forEach((fields, index) => {
    if (invalidRows.has(index + 1) || fields.every(value => !value.trim())) return;
    if (fields.length !== columns.length) {
      warnings.push(`CSV record ${index + 2} skipped: wrong number of fields`);
      return;
    }
    rows.push(fields);
    recordNumbers.push(index + 2);
  });
  return { columns, rows, recordNumbers, warnings };
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
  return buildFromParsed(parseCsv(text), options);
}

export function buildFromParsed(parsed, options) {
  const { columns, rows, recordNumbers, warnings } = parsed;
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
    axes.push({ column: columns.indexOf(header), x, header});
  });
  const groups = new Map();
  // Rows that have a name but no numbers at all; reported by name below.
  const emptyRows = [];
  const counts = new Map();
  const skip = reason => counts.set(reason, (counts.get(reason) || 0) + 1);
  for (const [rowIndex, fields] of rows.entries()) {
    const label = fields[0].trim();
    const record = recordNumbers[rowIndex];
    const key = nameKey(label);

    // Whole row blank except the label: note it and skip to the next row,
    // instead of counting each blank cell as "Y was blank".
    if (key && axes.every(({ column }) => !fields[column].trim())) {
      emptyRows.push({ key, label });
      continue;
    }

    for (const { column, x, header } of axes) {
      if (!key) { skip('group was blank'); continue; }
      const rawY = fields[column].trim();
      if (!rawY) { skip('Y was blank'); continue; }
      const y = Number(rawY);
      if (!numericPattern.test(rawY) || !Number.isFinite(y)) {
        skip('Y was not a finite number'); continue;
      }

      let entry = groups.get(key);
      if (!entry) {
        entry = { label, spellings:new Set(), records: new Set(), values: new Map() };
        groups.set(key, entry);
      }
      entry.spellings.add(label);
      entry.records.add(record);

      const kept = entry.values.get(x);
      if (kept) {
        kept.ignored.push({ y, record });
      } else {
        entry.values.set(x, { y, record, header, ignored: []});
      }
      //if (!groups.has(group)) groups.set(group, []);
      //groups.get(group).push([x, y]);
    }
  }

  const entries = [...groups.values()].sort((a,b) => a.label.localeCompare(b.label));
  for (const entry of entries) {
    if (entry.records.size > 1) {
      let spellings = '';   // default: same spelling on every row, so add nothing
      if (entry.spellings.size > 1) {
        spellings = ` as ${[...entry.spellings].map(s => `"${s}"`).join(', ')}`;
      }
      warnings.push(`"${entry.label}" appears in ${entry.records.size} rows ` +
        `(records ${[...entry.records].join(', ')})${spellings}; combined into one.`);
    }
    for (const { y, record, header, ignored } of entry.values.values()) {
      if (!ignored.length) continue;
      const others = ignored.map(o => `${o.y} (record ${o.record})`).join(', ');
      warnings.push(`"${entry.label}" has ${ignored.length + 1} values for ${header}: ` +
        `kept ${y} (record ${record}), ignored ${others}.`);
    }
  }

  const missing = [...new Set(emptyRows.filter(r => !groups.has(r.key)).map(r => r.label))];
  if (missing.length) {
    warnings.push(`${missing.length} ${missing.length === 1 ? 'row has' : 'rows have'} ` +
      `no data and ${missing.length === 1 ? 'was' : 'were'} left out: ${missing.join(', ')}.`);
  }


  /*result.series = [...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([group, points]) => ({ group, points: points.sort((a, b) => a[0] - b[0]) }));*/
  result.series = entries.map(({ label, values }) => ({
    group: label,
    points: [...values].map(([x, { y }]) => [x, y]).sort((a, b) => a[0] - b[0]),
  }));
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
