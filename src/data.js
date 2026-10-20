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
 * Changes: Now also returns rowNumbers, where rowNumbers[i] is the row in the file
 * that rows[i] came from (the header is row 1). Skipped rows make array
 * positions drift from the file's row numbers, so warnings need this to
 * point at the right row.
 * @param {string} text
 * @param {string} text
 * @returns {{columns: string[], rows: string[][], rowNumbers: number[], warnings: string[]}}
 */
export function parseCsv(text) {
  const warnings = [];
  const empty = () => ({ columns: [], rows: [], rowNumbers: [], warnings });
  if (typeof text !== 'string') {
    warnings.push('CSV input must be text');
    return empty();
  }
  // Keep row indexes intact so warnings refer to the original CSV rows.
  const { data, errors } = Papa.parse(text, { delimiter: ',' });
  const invalidRows = new Set(errors.map(error => error.row));
  warnings.push(...errors.map(error => `CSV row ${error.row + 1} skipped: ${error.message}`));
  const columns = data[0]?.map(value => value.trim());
  if (invalidRows.has(0) || !columns || columns.some(column => !column) ||
      new Set(columns).size !== columns.length) {
    warnings.push('CSV must have a header with nonempty, unique column names');
    return empty();
  }
  const rows = [];
  const rowNumbers = [];
  data.slice(1).forEach((fields, index) => {
    if (invalidRows.has(index + 1) || fields.every(value => !value.trim())) return;
    if (fields.length !== columns.length) {
      warnings.push(`CSV row ${index + 2} skipped: wrong number of fields`);
      return;
    }
    rows.push(fields);
    rowNumbers.push(index + 2);
  });
  return { columns, rows, rowNumbers, warnings };
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
 * 
 * Changes: repeated groups: rows whose labels match after nameKey() (e.g.
 * "Jay", "jay") are combined into one series, labelled with the first
 * spelling. If two rows give a value for the same column, the first is kept
 * and the rest are ignored. Both cases produce a warning.
 *
 * New, empty rows: a row with a label but no data in any column is left out
 * and reported by name, unless the same label has data in another row.
 * @param {string} text
 * @param {{xColumns?: string[],
 *   xType?: 'number' | 'category'}} [options]
 * @returns {{series: {group: string, points: [number, number][]}[],
 *   valueHeader: string | null, xType: 'number' | 'category',
 *   xTickLabels?: row<number, string>, warnings: string[]}}
 */
export function buildPlotData(text, options) {
  return buildFromParsed(parseCsv(text), options);
}

/**
 * buildPlotData for a CSV that is already parsed (the worker streams files
 * with Papa and passes the rows here). Same options and result.
 * @param {{columns: string[], rows: string[][], rowNumbers: number[], warnings: string[]}} parsed
 * @param {{xColumns?: string[], xType?: 'number' | 'category'}} [options]
 */
export function buildFromParsed(parsed, options) {
  const { columns, rows, rowNumbers, warnings } = parsed;
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

  // Rows that have a name but no numbers at all
  const emptyRows = [];
  const skipped = new Map();
  const skip = (reason, where) => {
    if (!skipped.has(reason)) skipped.set(reason, []);
    skipped.get(reason).push(where);
  };

  for (const [rowIndex, fields] of rows.entries()) {
    const label = fields[0].trim();
    const row = rowNumbers[rowIndex];
    const key = nameKey(label);

    if (!key) {
      skip('noLabel', `row ${row}`);
      continue;
    }

    // Whole row blank except the label: note it and skip to the next row,
    // instead of counting each blank cell as "Y was blank".
    if (key && axes.every(({ column }) => !fields[column].trim())) {
      emptyRows.push({ key, label });
      continue;
    }

    for (const { column, x, header } of axes) {
      if (!key) { skip('group was blank'); continue; }
      const rawY = fields[column].trim();
      //more descriptive errors
      if (!rawY) { skip('blank', `${label} (${header})`); continue; }
      const y = Number(rawY);
      if (!numericPattern.test(rawY) || !Number.isFinite(y)) {
        skip('notNumber', `${label} (${header}: "${rawY}")`); continue;
      }

      let entry = groups.get(key);
      if (!entry) {
        entry = { label, spellings:new Set(), rows: new Set(), values: new Map() };
        groups.set(key, entry);
      }
      entry.spellings.add(label);
      entry.rows.add(row);

      const kept = entry.values.get(x);
      if (kept) {
        kept.ignored.push({ y, row });
      } else {
        entry.values.set(x, { y, row, header, ignored: []});
      }
      //if (!groups.has(group)) groups.set(group, []);
      //groups.get(group).push([x, y]);
    }
  }

  // different error messages 
  const list = items => items.length <= 5
    ? items.join(', ')
    : `${items.slice(0, 5).join(', ')} …and ${items.length - 5} more`;
  const plural = (n, one, many) => (n === 1 ? one : many);

  const entries = [...groups.values()].sort((a,b) => a.label.localeCompare(b.label));
  // Changed: collect duplicate-name messages first instead of adding them
  // straight to warnings, so they can be capped at 5 like the blank cells.
  const combined = [];
  const conflicts = [];
  for (const entry of entries) {
    if (entry.rows.size > 1) {
      let spellings = '';   // default: same spelling on every row, so add nothing
      if (entry.spellings.size > 1) {
        spellings = ` as ${list([...entry.spellings].map(s => `"${s}"`))}`;
      }
      combined.push(`"${entry.label}" appears in ${entry.rows.size} rows ` +
        `(rows ${list([...entry.rows])})${spellings}; combined into one.`);
    }
    for (const { y, row, header, ignored } of entry.values.values()) {
      if (!ignored.length) continue;
      const others = list(ignored.map(o => `${o.y} (row ${o.row})`));
      conflicts.push(`"${entry.label}" has ${ignored.length + 1} values for ${header}: ` +
        `kept ${y} (row ${row}), ignored ${others}.`);
    }
  }

  // New thing: adding the first 5 messages of a kind, then one summary line for the rest.
  // ex: …and 3 more names combined from several rows.
  const capped = (messages, one, many) => {
    warnings.push(...messages.slice(0, 5));
    const extra = messages.length - 5;
    if (extra > 0) warnings.push(`…and ${extra} more ${plural(extra, one, many)}.`);
  };
  capped(combined, 'name combined from several rows', 'names combined from several rows');
  capped(conflicts, 'column with more than one value', 'columns with more than one value');

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

  // ex: 1 row skipped because the first column is empty: row 8.
  const noLabel = skipped.get('noLabel') ?? [];
  if (noLabel.length) {
    warnings.push(`${noLabel.length} ${plural(noLabel.length, 'row', 'rows')} ` +
      `skipped because the first column is empty: ${list(noLabel)}.`);
  }
  // ex: 1 blank cell skipped: name (header).
  const blank = skipped.get('blank') ?? [];
  if (blank.length) {
    warnings.push(`${blank.length} blank ${plural(blank.length, 'cell', 'cells')} ` +
      `skipped: ${list(blank)}.`);
  }
  // ex 2 cells skipped because they aren't a number: name (header: "n/a"), ...
  const notNumber = skipped.get('notNumber') ?? [];
  if (notNumber.length) {
    warnings.push(`${notNumber.length} ${plural(notNumber.length, 'cell', 'cells')} ` +
      `skipped because ${plural(notNumber.length, "it isn't", "they aren't")} a number: ` +
      `${list(notNumber)}.`);
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
