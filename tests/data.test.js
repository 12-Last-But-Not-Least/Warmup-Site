import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseCsv, buildPlotData } from '../src/data.js';

test('all bundled CSVs remain usable', async () => {
  const paths = ['data/DATA - Step Count.csv', 'data/DATA - Hours of Sleep.csv',
    ...(await readdir('data/examples')).filter(p => p.endsWith('.csv')).map(p => `data/examples/${p}`)];
  for (const path of paths) {
    const result = buildPlotData(await readFile(path, 'utf8'));
    assert.deepEqual(result.errors, [], path);
    assert.ok(result.series.length, path);
  }
});

for (const [name, input] of [
  ['empty', ''], ['whitespace', '  \n'], ['nontext', null],
  ['header only', 'Metric,Monday'], ['missing categories', 'Metric\nJay'],
  ['blank header', 'Metric,\nJay,2'], ['duplicate headers', 'Metric,Monday, Monday \nJay,1,2'],
  ['duplicate people', 'Metric,Monday\nJay,1\n Jay ,2'],
  ['malformed quoting', 'Metric,Monday\nJay,"2'],
  ['no numeric observations', 'Metric,Monday\nJay,abc'],
]) {
  test(`rejects ${name}`, () => {
    assert.ok(parseCsv(input).errors.length);
    assert.equal(buildPlotData(input).series.length, 0);
  });
}

test('skips invalid cells without converting blanks to zero', () => {
  const input = 'Metric,A,B,C,D,E,F,G,H,I\nJay,0,,abc,Infinity,NaN,0x10,2.5,-3,1e2';
  const result = buildPlotData(input);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.series[0].points, [[0,0],[6,2.5],[7,-3],[8,100]]);
  assert.equal(result.warnings.length, 5);
  assert.match(result.warnings[0], /record 2, column 3/);
});

test('skips wrong-width and blank-name rows with original record numbers', () => {
  const result = parseCsv('Metric,A\n\nJay,1,2\n,4\nSam,3\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [['Sam','3']]);
  assert.match(result.warnings[0], /record 3/);
  assert.match(result.warnings[1], /record 4, column 1/);
});

test('handles BOM, CRLF, quoted commas, escaped quotes and multiline fields', () => {
  const result = parseCsv('\uFEFFMetric,"Day, 1"\r\n"Jay ""J""\nSmith",2\r\n');
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.columns, ['Metric','Day, 1']);
  assert.deepEqual(result.rows, [['Jay "J"\nSmith','2']]);
});
