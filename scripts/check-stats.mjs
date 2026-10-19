// Sanity check for the grouped statistics in src/stats.js: `npm run check:stats`.
// Runs groupStats over every CSV in data/ (any file a user could upload has the
// same shape) plus inline edge cases, prints the tables, and fails on any
// broken invariant.
import { readdir, readFile } from 'node:fs/promises';
import { buildPlotData } from '../src/data.js';
import { groupStats, pointsFromSeries } from '../src/stats.js';

const EDGE_CASES = {
  'reversed columns': 'Sales,Mar,Feb,Jan\nA,3,2,1\nB,6,5,4',
  'duplicate row label': 'Score,W1,W2\nAna,1,2\nAna,3,4\nBen,5,6',
  'all-blank row': 'Score,W1,W2\nAna,,\nBen,5,6',
  'one value in a group': 'Score,W1,W2\nAna,7,\nBen,5,6',
  'negative values': 'Temp,Jan,Feb\nOslo,-4.5,-3\nRome,8,9',
  'header only': 'Score,W1,W2',
  'single cell': 'Score',
};

/** @type {string[]} */
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/**
 * @param {string} name
 * @param {string} text
 * @param {Parameters<typeof buildPlotData>[1]} [options]
 */
function run(name, text, options) {
  const data = buildPlotData(text, options);
  const points = pointsFromSeries(data.series);
  console.log(`\n=== ${name} — ${data.valueHeader ?? '(no header)'} (${points.length} points)`);

  for (const by of /** @type {const} */ (['group', 'x'])) {
    const rows = groupStats(points, by, data.xTickLabels);
    if (rows.length) {
      console.log(`by ${by}:`);
      console.table(Object.fromEntries(rows.map(({ label, stats }) =>
        [label, Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))])));
    }

    const total = rows.reduce((s, r) => s + r.stats.n, 0);
    check(total === points.length, `${name} by ${by}: n sums to ${total}, expected ${points.length}`);
    for (const { label, stats } of rows) {
      check(stats.min <= stats.mean && stats.mean <= stats.max, `${name} by ${by}: ${label} mean outside [min, max]`);
      check(stats.min <= stats.median && stats.median <= stats.max, `${name} by ${by}: ${label} median outside [min, max]`);
      check(stats.n > 1 || Number.isNaN(stats.sd), `${name} by ${by}: ${label} has sd with n = 1`);
    }
    const expected = by === 'group'
      ? data.series.map((s) => s.group)
      : [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
    check(JSON.stringify(rows.map((r) => r.key)) === JSON.stringify(expected), `${name} by ${by}: unexpected order`);
  }
}

for (const dir of ['data', 'data/examples']) {
  const url = new URL(`../${dir}/`, import.meta.url);
  for (const file of (await readdir(url)).filter((f) => f.endsWith('.csv')).sort()) {
    run(`${dir}/${file}`, await readFile(new URL(file, url), 'utf8'));
  }
}
for (const [name, text] of Object.entries(EDGE_CASES)) run(name, text);
run('numeric x headers', 'Pop,2020,2010,2000\nA,3,2,1\nB,6,5,4', { xType: 'number' });

// Hand-computed expectations.
const dup = groupStats(pointsFromSeries(buildPlotData(EDGE_CASES['duplicate row label']).series));
// The parser combines duplicate names and keeps the first value per column.
check(dup[0].label === 'Ana' && dup[0].stats.n === 2 && dup[0].stats.mean === 1.5, 'duplicate rows should merge into one group');
const rev = buildPlotData(EDGE_CASES['reversed columns']);
const revCols = groupStats(pointsFromSeries(rev.series), 'x', rev.xTickLabels).map((r) => r.label);
check(revCols.join() === 'Mar,Feb,Jan', `columns should keep file order, got ${revCols}`);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed.');
}
