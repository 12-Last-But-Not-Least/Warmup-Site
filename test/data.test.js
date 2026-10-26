import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlotData, parseCsv } from '../src/data.js';

describe('parseCsv', () => {
  it('rejects non-string input', () => {
    for (const input of [undefined, null, 42, {}]) {
      expect(parseCsv(input)).toEqual({ columns: [], rows: [], warnings: ['CSV input must be text'] });
    }
  });

  it('parses a simple CSV and trims headers only', () => {
    const { columns, rows, warnings } = parseCsv(' Name , A\nx, 1 \n');
    expect(columns).toEqual(['Name', 'A']);
    expect(rows).toEqual([['x', ' 1 ']]);
    expect(warnings).toEqual([]);
  });

  it('warns about an empty file', () => {
    const { columns, rows, warnings } = parseCsv('');
    expect(columns).toEqual([]);
    expect(rows).toEqual([]);
    expect(warnings).toContain('CSV must have a header with nonempty, unique column names');
  });

  it('accepts a header-only file', () => {
    expect(parseCsv('a,b')).toEqual({ columns: ['a', 'b'], rows: [], warnings: [] });
  });

  it('rejects blank header names', () => {
    expect(parseCsv('a,,c\n1,2,3').columns).toEqual([]);
    expect(parseCsv('a, ,c\n1,2,3').warnings).toHaveLength(1);
  });

  it('rejects duplicate headers but treats case as significant', () => {
    expect(parseCsv('a,a\n1,2').columns).toEqual([]);
    expect(parseCsv('a,A\n1,2').columns).toEqual(['a', 'A']);
  });

  it('handles quoted fields with commas, quotes and newlines', () => {
    const { rows } = parseCsv('g,v\n"Smith, J","say ""hi"""\n"two\nlines",3\n');
    expect(rows).toEqual([['Smith, J', 'say "hi"'], ['two\nlines', '3']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n3,4\r\n').rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('skips blank rows silently', () => {
    const { rows, warnings } = parseCsv('a,b\n1,2\n\n , \n3,4');
    expect(rows).toEqual([['1', '2'], ['3', '4']]);
    expect(warnings).toEqual([]);
  });

  it('skips rows with the wrong number of fields, naming the record', () => {
    const { rows, warnings } = parseCsv('a,b\n1,2\n3\n4,5,6\n7,8');
    expect(rows).toEqual([['1', '2'], ['7', '8']]);
    expect(warnings.filter(w => w.endsWith('wrong number of fields')))
      .toEqual(['CSV record 3 skipped: wrong number of fields', 'CSV record 4 skipped: wrong number of fields']);
  });

  it('reports malformed quoting without losing the header', () => {
    const { columns, warnings } = parseCsv('a,b\n"unterminated,2\n');
    expect(columns).toEqual(['a', 'b']);
    expect(warnings.some(w => w.startsWith('CSV record'))).toBe(true);
  });

  it('only splits on commas', () => {
    expect(parseCsv('a;b\n1;2').columns).toEqual(['a;b']);
  });
});

const weekdays = 'Steps,Mon,Tue,Wed\nAna,1,2,3\nBen,4,5,6';

describe('buildPlotData', () => {
  it('uses the first header as the value header and the rest as categories', () => {
    const data = buildPlotData(weekdays);
    expect(data.valueHeader).toBe('Steps');
    expect(data.xType).toBe('category');
    expect(data.xTickLabels).toEqual({ 0: 'Mon', 1: 'Tue', 2: 'Wed' });
    expect(data.series).toEqual([
      { group: 'Ana', points: [[0, 1], [1, 2], [2, 3]] },
      { group: 'Ben', points: [[0, 4], [1, 5], [2, 6]] },
    ]);
    expect(data.warnings).toEqual([]);
  });

  it('returns an empty result with the CSV warnings for unusable input', () => {
    const data = buildPlotData('');
    expect(data.series).toEqual([]);
    expect(data.valueHeader).toBeNull();
    expect(data.warnings.length).toBeGreaterThan(0);
  });

  it('treats null options like no options', () => {
    expect(buildPlotData(weekdays, null).series).toHaveLength(2);
  });

  it('respects a subset and order of xColumns for categories', () => {
    const data = buildPlotData(weekdays, { xColumns: ['Wed', 'Mon'] });
    expect(data.xTickLabels).toEqual({ 0: 'Wed', 1: 'Mon' });
    // Points are sorted by x (the column position in xColumns), not by CSV order.
    expect(data.series[0].points).toEqual([[0, 3], [1, 1]]);
  });

  it('rejects an unknown xType but still reports no series', () => {
    const data = buildPlotData(weekdays, { xType: 'date' });
    expect(data.series).toEqual([]);
    expect(data.warnings).toContain('X type must be number or category');
  });

  it.each([
    ['empty array', []],
    ['not an array', 'Mon'],
    ['unknown header', ['Nope']],
    ['first column', ['Steps']],
    ['duplicates', ['Mon', 'Mon']],
  ])('rejects invalid xColumns: %s', (_, xColumns) => {
    const data = buildPlotData(weekdays, { xColumns });
    expect(data.series).toEqual([]);
    expect(data.warnings).toContain('Select unique existing X headers after the first column');
  });

  describe('numeric X', () => {
    const csv = 'Score,2020,-1.5,1e3,abc\nAna,1,2,3,4';

    it('uses header values as x, skipping non-numeric headers', () => {
      const data = buildPlotData(csv, { xType: 'number' });
      expect(data.xTickLabels).toBeUndefined();
      expect(data.series[0].points).toEqual([[-1.5, 2], [1000, 3], [2020, 1]]);
      expect(data.warnings).toEqual(['X header "abc" skipped: not a finite number']);
    });

    it('yields no series when every header is non-numeric', () => {
      const data = buildPlotData('V,a,b\nAna,1,2', { xType: 'number' });
      expect(data.series).toEqual([]);
      expect(data.warnings).toHaveLength(2);
    });

    it('rejects headers that overflow to Infinity', () => {
      const data = buildPlotData('V,1e999\nAna,1', { xType: 'number' });
      expect(data.series).toEqual([]);
      expect(data.warnings).toEqual(['X header "1e999" skipped: not a finite number']);
    });
  });

  describe('Y values', () => {
    const y = value => buildPlotData(`V,X\nAna,${value}`).series[0]?.points[0]?.[1];

    it.each([['5', 5], [' 5 ', 5], ['.5', 0.5], ['5.', 5], ['+5', 5], ['-2.5', -2.5], ['1e3', 1000], ['0', 0]])(
      'accepts %j', (raw, expected) => expect(y(raw)).toBe(expected));

    it.each(['abc', '1,000', '0x10', 'NaN', 'Infinity', '1e999', '--1'])(
      'rejects %j', raw => expect(y(raw)).toBeUndefined());
  });

  it('counts skipped observations by reason with singular and plural wording', () => {
    const csv = 'V,A,B\nAna,,x\nBen,1,2\n,3,4\n,5,6\nCy,7,\n';
    const { warnings, series } = buildPlotData(csv);
    expect(series.map(s => s.group)).toEqual(['Ben', 'Cy']);
    expect(warnings.sort()).toEqual([
      '1 observation skipped: Y was not a finite number',
      '2 observations skipped: Y was blank',
      '4 observations skipped: group was blank',
    ]);
  });

  it('trims group names, preserves case and merges repeated groups', () => {
    const { series } = buildPlotData('V,A,B\n Ana ,1,2\nAna,3,4\nana,5,6');
    expect(series.map(s => s.group)).toEqual(['ana', 'Ana'].sort((a, b) => a.localeCompare(b)));
    const ana = series.find(s => s.group === 'Ana');
    expect(ana.points).toEqual([[0, 1], [0, 3], [1, 2], [1, 4]]);
  });

  it('sorts series by group name', () => {
    const { series } = buildPlotData('V,A\nZed,1\nAmy,2\nMia,3');
    expect(series.map(s => s.group)).toEqual(['Amy', 'Mia', 'Zed']);
  });
});

describe('example datasets', () => {
  const dir = new URL('../data/examples/', import.meta.url);
  const files = readdirSync(dir).filter(name => name.endsWith('.csv'));
  const load = url => buildPlotData(readFileSync(url, 'utf8'));

  it('has example files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s yields series and only blank-cell warnings', name => {
    const data = load(new URL(name, dir));
    expect(data.series.length).toBeGreaterThan(0);
    expect(data.valueHeader).toBeTruthy();
    for (const warning of data.warnings) expect(warning).toMatch(/observations? skipped: Y was blank/);
  });

  it.each(['DATA - Step Count.csv', 'DATA - Hours of Sleep.csv'])('%s has data with blank cells reported', name => {
    const data = load(new URL(`../data/${name}`, import.meta.url));
    expect(data.series.length).toBeGreaterThan(0);
    expect(data.warnings).toEqual(['42 observations skipped: Y was blank']);
  });
});
