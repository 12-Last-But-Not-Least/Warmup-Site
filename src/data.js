import Papa from 'papaparse';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Join raw Monday–Sunday CSV exports into { rows, warnings }. */
export function buildRows(stepsCsvText, sleepCsvText) {
  const steps = readSheet(stepsCsvText, 'steps');
  const sleep = readSheet(sleepCsvText, 'sleep_hours');
  const rows = [];
  for (const [key, step] of steps.rows) {
    const night = sleep.rows.get(key);
    if (night) rows.push({ person: step.person, weekday: step.weekday, steps: step.value, sleepHours: night.value });
  }
  rows.sort((a, b) => a.person.localeCompare(b.person) || a.weekday - b.weekday);
  return { rows, warnings: [...steps.warnings, ...sleep.warnings] };
}

function readSheet(text, metric) {
  const rows = new Map(), warnings = [];
  if (typeof text !== 'string') {
    return { rows, warnings: [`${metric}: CSV input must be text`] };
  }
  const { data, errors } = Papa.parse(text, { delimiter: ',' });
  const invalidRows = new Set(errors.map(error => error.row));
  warnings.push(...errors.map(error => `${metric}: CSV record ${error.row + 1} skipped: ${error.message}`));
  const header = data.shift()?.map(value => value.trim().toLowerCase());
  if (invalidRows.has(0) || !header || header.length !== 8 || new Set(header).size !== 8 ||
      weekdays.includes(header[0]) || !weekdays.every(day => header.includes(day))) {
    warnings.push(`${metric}: expected a name column followed by Monday–Sunday columns`);
    return { rows, warnings };
  }
  const columns = weekdays.map(day => header.indexOf(day));
  const counts = new Map();
  const skip = reason => counts.set(reason, (counts.get(reason) || 0) + 1);
  data.forEach((fields, index) => {
    if (invalidRows.has(index + 1) || fields.every(value => !value.trim())) return;
    if (fields.length !== header.length) {
      warnings.push(`${metric}: CSV record ${index + 2} skipped: wrong number of fields`);
      return;
    }
    const person = fields[0].normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
      .replace(/(^|[\s\-'’])\p{L}/gu, letter => letter.toUpperCase());
    if (!person) {
      warnings.push(`${metric}: CSV record ${index + 2} skipped: person was blank`);
      return;
    }
    columns.forEach((column, weekday) => {
      const raw = fields[column].trim(), value = Number(raw);
      if (!raw) { skip(`${metric} was blank`); return; }
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(value)) {
        skip(`${metric} wasn't a number`); return;
      }
      if (metric === 'steps' && (!Number.isSafeInteger(value) || value < 0)) {
        skip('steps must be a nonnegative safe integer'); return;
      }
      if (metric === 'sleep_hours' && (value < 0 || value > 24)) {
        skip('sleep_hours must be between 0 and 24'); return;
      }
      const key = JSON.stringify([person, weekday]);
      if (rows.has(key)) { skip('duplicate person/weekday (kept first valid value)'); return; }
      rows.set(key, { person, weekday, value });
    });
  });
  for (const [reason, count] of counts) {
    warnings.push(`${metric}: ${count} ${count === 1 ? 'value' : 'values'} skipped: ${reason}`);
  }
  return { rows, warnings };
}

// File access runs only when this module is Node's entry point.
async function main() {
  const { readFile, writeFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const [steps, sleep] = await Promise.all([
    readFile(new URL('../data/DATA - Step Count.csv', import.meta.url), 'utf8'),
    readFile(new URL('../data/DATA - Hours of Sleep.csv', import.meta.url), 'utf8'),
  ]);
  const result = buildRows(steps, sleep);
  const output = new URL('../data/result.json', import.meta.url);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${result.rows.length} rows and ${result.warnings.length} warnings to ${fileURLToPath(output)}`);
}

if (import.meta.main) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
