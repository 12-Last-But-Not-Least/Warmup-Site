import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlotData } from '../src/data.js';
import { createModel, generatedPair, extent, LIMITS } from '../src/model.js';
import { exportFileName } from '../src/export-name.js';
import Papa from '../src/vendor/papa.js';
const model = (a, b) => createModel(buildPlotData(a), buildPlotData(b));

test('cross-file names normalize and columns pair by label, including reordered headers', () => {
  const m = model('Steps,Mon,Tue\nJay,1,2\nAna Lopez,3,4', 'Sleep,Tue,Mon\njay,20,10\nANA  LOPEZ,40,30');
  assert.equal(m.view().counts[2], 4);
  assert.deepEqual(m.table({ source: 2 }).rows, [['Ana Lopez', 'Mon', 30, 3], ['Ana Lopez', 'Tue', 40, 4], ['Jay', 'Mon', 10, 1], ['Jay', 'Tue', 20, 2]]);
});
test('duplicate cells keep first valid number, missing values never become zero', () => {
  const d = buildPlotData('Steps,Mon,Tue\nJay,1,\njay,999,2');
  assert.deepEqual(d.series[0].points, [[0, 1], [1, 2]]);
  assert.ok(d.warnings.some(w => w.includes('ignored 999')));
});
test('pagination is capped; sorting is global before slicing; export table includes all rows', () => {
  const [a,b] = generatedPair(1000).map(t => buildPlotData(t));
  const m = createModel(a,b);
  const v = m.view();
  assert.deepEqual(v.counts,[7000,7000,7000]);
  assert.deepEqual(v.charts.map(c=>c.points.length),[7,7,3000]);
  assert.equal(m.page({ mode:'detail', size:10000 }).rows.length,50);
  assert.equal(m.page({ mode:'detail', size:100 }).rows.length,100);
  assert.equal(m.page({ mode:'detail', page:139 }).rows.length,50);
  assert.equal(m.table({ mode:'detail' }).rows.length,7000);
  const sorted = m.table({ mode:'detail', sortBy:'value' }).rows;
  assert.ok(sorted.every((r,i)=>i===0||sorted[i-1][2]<=r[2]));
  assert.equal(m.view().fit.r,v.fit.r);
});
test('filtering is normalized and changes analysis; empty filter result remains usable', () => {
  const [a,b] = generatedPair(50).map(t => buildPlotData(t));
  const m = createModel(a,b);
  assert.deepEqual(m.view({ query:' PERSON 00001 ' }).counts,[7,7,7]);
  assert.equal(m.page({ query:'PERSON 00001', mode:'detail' }).total,7);
  assert.deepEqual(m.view({ query:'absent' }).counts,[0,0,0]);
  assert.equal(m.page({ query:'absent' }).pages,1);
});
test('group/category summaries use the full data; sample standard deviation is n-1', () => {
  const m = model('A,Mon,Tue\nJay,1,3\nAna,3,5','B,Mon,Tue\nJay,2,4\nAna,4,6');
  const group = m.table({ mode:'group' });
  assert.deepEqual(group.rows[0].slice(0,4),['Ana',2,4,4]);
  assert.equal(group.rows[0][4],Math.sqrt(2));
  assert.deepEqual(m.table({ mode:'category' }).rows[0].slice(0,4),['Mon',2,2,2]);
});
test('log exclusions are counted separately and never silently change the raw analysis sample', () => {
  const [a,b] = generatedPair(8,true).map(t=>buildPlotData(t));
  const v = createModel(a,b).view();
  assert.equal(v.fit.n,56);
  assert.equal(v.charts[2].xNonPositive,8);
  assert.equal(v.charts[2].yNonPositive,8);
  assert.equal(v.charts[2].eitherNonPositive,16);
});
test('large extents avoid function argument expansion; 10,000 groups use bounded drawing payload', () => {
  assert.deepEqual(extent(Array.from({length:150000},(_,i)=>({x:i})), 'x').linear,[0,149999]);
  const [a,b] = generatedPair(10000).map(t=>buildPlotData(t));
  const m = createModel(a,b), v = m.view();
  assert.equal(v.fit.n,70000);
  assert.ok(v.charts.every(c=>c.points.length<=LIMITS.drawn));
  assert.equal(m.page({ source:2 }).rows.length,50);
});
test('CSV serialization round trips exact numeric values and quoted labels', () => {
  const input = [['Group','Value'],['A, "quoted"',1.23456789],['=text',4]];
  const csv = Papa.unparse(input,{ escapeFormulae:true });
  const parsed = Papa.parse(csv).data;
  assert.equal(parsed[1][0],input[1][0]);
  assert.equal(Number(parsed[1][1]),1.23456789);
  assert.equal(parsed[2][0],"'=text");
});

test('legend hiding is independent per chart and recomputes full-data means and fit', () => {
  const m = model('A,Mon,Tue\nJay,1,3\nAna,3,5','B,Mon,Tue\nJay,2,4\nAna,4,6');
  const hidden = m.view({ hiddenBySource: [['Ana'], [], ['Jay']] });
  assert.deepEqual(hidden.counts, [2,4,2]);
  assert.equal(hidden.stats[0].mean, 2);
  assert.equal(hidden.stats[1].mean, 4);
  assert.equal(hidden.fit.n, 2);
  assert.deepEqual(hidden.charts[0].groupNames, ['Ana', 'Jay']);
  assert.deepEqual(hidden.charts[0].hiddenGroups, ['Ana']);
  assert.equal(hidden.charts[0].hiddenObservations, 2);
  assert.deepEqual(hidden.charts[0].meanPoints.map(p => p.y), [1,3]);
  assert.deepEqual(m.table({source:0, excludedGroups:['Ana']}).rows.map(r=>r[0]), ['Jay','Jay']);
  assert.equal(m.table({source:0}).rows.length, 4);
  const empty = m.view({hiddenBySource:[['Ana','Jay']]});
  assert.equal(empty.charts[0].points.length, 0);
  assert.deepEqual(empty.charts[0].groupNames, ['Ana','Jay']);
  assert.deepEqual(m.view().counts, [4,4,4]);
});

test('large-data overview recomputes means after exclusions without losing legend groups', () => {
  const [a,b] = generatedPair(1000).map(t=>buildPlotData(t));
  const m = createModel(a,b);
  const input = m.view({hiddenBySource:[['Person 00001']]}).charts[0];
  assert.equal(input.sourceTotal, 6993);
  assert.equal(input.groupNames.length, 1000);
  assert.equal(input.meanPoints[0].n, 999);
  assert.equal(m.page({mode:'group',excludedGroups:['Person 00001']}).total, 999);
});

test('the scatter carries a model-computed fit only when its points are a drawing sample', () => {
  const small = createModel(...generatedPair(50).map(t => buildPlotData(t))).view().charts[2];
  assert.ok(small.points.length === small.total);
  assert.equal(small.statsOverride, undefined, 'unsampled charts must let the chart (and setStatsProvider) compute stats');
  const large = createModel(...generatedPair(1000).map(t => buildPlotData(t))).view().charts[2];
  assert.ok(large.points.length < large.total);
  assert.equal(large.statsOverride.n, large.total, 'sampled charts keep the full-data fit');
});

test('matched pairs keep original category order within each group (M1)', () => {
  const m = createModel(...generatedPair(3).map(t => buildPlotData(t)));
  const rows = m.table({ source: 2, mode: 'detail', sortBy: 'group' }).rows;
  const first = rows.filter(r => r[0] === rows[0][0]).map(r => r[1]);
  assert.deepEqual(first, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

test('sorting takes a column and a direction, including summary statistics (Y3)', () => {
  const m = createModel(...generatedPair(30).map(t => buildPlotData(t)));
  const col = (rows, i) => rows.map(r => r[i]);
  const ascending = values => values.every((v, i) => i === 0 || values[i - 1] <= v);
  const descending = values => values.every((v, i) => i === 0 || values[i - 1] >= v);
  assert.ok(descending(col(m.table({ mode: 'detail', sortBy: 'value', direction: 'desc' }).rows, 2)));
  const groupsDesc = col(m.table({ mode: 'detail', sortBy: 'group', direction: 'desc' }).rows, 0);
  assert.ok(groupsDesc.every((g, i) => i === 0 || groupsDesc[i - 1].localeCompare(g) >= 0));
  const summary = m.table({ mode: 'group', sortBy: 'median' });
  const median = summary.columns.indexOf('Median'), sd = summary.columns.indexOf('Sample SD');
  assert.ok(ascending(col(summary.rows, median)));
  assert.ok(descending(col(m.table({ mode: 'group', sortBy: 'sd', direction: 'desc' }).rows, sd)));
  const byCategory = col(m.table({ mode: 'category', sortBy: 'group' }).rows, 0);
  assert.deepEqual(byCategory, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], 'default order follows the original categories');
});

test('tables report one decimal count per column from the data precision, capped at 3 (Y4)', () => {
  const m = createModel(...generatedPair(30).map(t => buildPlotData(t)));   // steps: integers; sleep: 3 decimals
  const steps = m.table({ source: 0, mode: 'group' });
  assert.deepEqual(steps.decimals, [null, 0, 1, 1, 1, 0, 0]);
  assert.deepEqual(m.table({ source: 1, mode: 'group' }).decimals, [null, 0, 3, 3, 3, 3, 3]);
  assert.deepEqual(m.table({ source: 2, mode: 'detail' }).decimals, [null, null, 3, 0]);
  assert.deepEqual(m.view().precision, [0, 3]);
});

test('export file names name both datasets, the view and a data fingerprint (M3)', () => {
  const view = createModel(...generatedPair(5).map(t => buildPlotData(t))).view();
  const name = exportFileName(view, { source: 2, mode: 'detail' }, 35);
  assert.match(name, /^daily-steps_vs_sleep-hours__pairs-obs__35r__[0-9a-f]{6}\.csv$/);
  assert.match(exportFileName(view, { source: 0, mode: 'group', query: 'per' }, 3), /__f1-bygrp-flt__3r__/);
  assert.match(exportFileName(view, { source: 1, mode: 'category', excludedGroups: ['Person 00001'] }, 7), /__f2-bycat-flt__7r__/);
  const same = createModel(...generatedPair(5).map(t => buildPlotData(t))).view();
  const changed = createModel(...generatedPair(6).map(t => buildPlotData(t))).view();
  assert.equal(same.fingerprint, view.fingerprint, 'identical data gives the same id');
  assert.notEqual(changed.fingerprint, view.fingerprint, 'a different version of the pair gives a different id');
  assert.match(exportFileName({ labels: ['  ', 'Été / 2026 (v2)'], fingerprint: 'abcdef' }, { source: 0, mode: 'detail' }, 1), /^data_vs_ete-2026-v2__f1-obs__1r__abcdef\.csv$/);
});

test('matched pairs sort by either value column, in both directions (Y3 follow-up)', () => {
  const m = createModel(...generatedPair(20).map(t => buildPlotData(t)));
  const table = m.table({ source: 2, mode: 'detail' });
  assert.deepEqual(table.columns.slice(2), ['Sleep (hours)', 'Daily steps'], 'pairs show the second file, then the first');
  const col = (opts, i) => m.table({ source: 2, mode: 'detail', ...opts }).rows.map(r => r[i]);
  const ascending = v => v.every((x, i) => i === 0 || v[i - 1] <= x), descending = v => v.every((x, i) => i === 0 || v[i - 1] >= x);
  assert.ok(ascending(col({ sortBy: 'second' }, 2)), 'second file value ascending');
  assert.ok(descending(col({ sortBy: 'second', direction: 'desc' }, 2)), 'second file value descending');
  assert.ok(ascending(col({ sortBy: 'value' }, 3)), 'first file value ascending');
  assert.ok(ascending(col({ source: 0, sortBy: 'second' }, 2)), 'single-file sources fall back to their value');
});
