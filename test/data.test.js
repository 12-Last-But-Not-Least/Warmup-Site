import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPlotData, parseCsv } from '../src/data.js';

describe('parseCsv: errors', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an empty string', ''],
    ['whitespace', '  \n'],
  ])('rejects %s as input', (_, input) => {
    expect(parseCsv(input)).toEqual({
      columns: [], rows: [], errors: ['CSV input must be nonempty text'], warnings: [],
    });
  });

  it.each([
    ['header only', 'Metric,Monday'],
    ['a single column', 'Metric\nJay'],
    ['a blank header', 'Metric,\nJay,2'],
    ['a whitespace-only header', 'Metric, ,Tue\nJay,1,2'],
    ['duplicate headers', 'Metric,Monday, Monday \nJay,1,2'],
    ['duplicate people', 'Metric,Monday\nJay,1\n Jay ,2'],
    ['malformed quoting', 'Metric,Monday\nJay,"2'],
    ['no numeric observations', 'Metric,Monday\nJay,abc'],
  ])('rejects %s', (_, input) => {
    expect(parseCsv(input).errors.length).toBeGreaterThan(0);
    expect(buildPlotData(input).series).toEqual([]);
  });

  it('treats header case as significant', () => {
    expect(parseCsv('M,a,A\nJay,1,2').errors).toEqual([]);
  });

  it('names the record for a malformed quote', () => {
    expect(parseCsv('Metric,Monday\nJay,"2').errors[0]).toMatch(/^CSV record 2:/);
  });

  it('names the record for a duplicate person', () => {
    expect(parseCsv('Metric,Monday\nJay,1\n Jay ,2').errors)
      .toEqual(['CSV record 3, column 1: duplicate group "Jay"']);
  });

  it('only splits on commas', () => {
    expect(parseCsv('a;b\n1;2').errors.length).toBeGreaterThan(0); // one column
  });
});

describe('parseCsv: rows', () => {
  it('parses a simple CSV, trimming headers, groups and cells', () => {
    expect(parseCsv(' Metric , A \n Jay , 1 \n')).toEqual({
      columns: ['Metric', 'A'], rows: [['Jay', '1']], errors: [], warnings: [],
    });
  });

  it('handles a BOM, CRLF, quoted commas, escaped quotes and multiline fields', () => {
    const result = parseCsv('﻿Metric,"Day, 1"\r\n"Jay ""J""\nSmith",2\r\n');
    expect(result.errors).toEqual([]);
    expect(result.columns).toEqual(['Metric', 'Day, 1']);
    expect(result.rows).toEqual([['Jay "J"\nSmith', '2']]);
  });

  it('ignores completely blank rows without warning', () => {
    const { rows, warnings } = parseCsv('M,A\nJay,1\n\n , \nSam,2');
    expect(rows).toEqual([['Jay', '1'], ['Sam', '2']]);
    expect(warnings).toEqual([]);
  });

  it('skips wrong-width and blank-name rows, keeping original record numbers', () => {
    const result = parseCsv('Metric,A\n\nJay,1,2\n,4\nSam,3\n');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([['Sam', '3']]);
    expect(result.warnings).toEqual([
      'CSV record 3 skipped: expected 2 fields, found 3',
      'CSV record 4, column 1 skipped: group name is blank',
    ]);
  });

  it('blanks invalid cells without converting them to zero, and warns for each', () => {
    const { rows, warnings, errors } = parseCsv('M,A,B,C,D,E,F,G,H,I\nJay,0,,abc,Infinity,NaN,0x10,2.5,-3,1e2');
    expect(errors).toEqual([]);
    expect(rows).toEqual([['Jay', '0', '', '', '', '', '', '2.5', '-3', '1e2']]);
    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toBe('CSV record 2, column 3 ("B") skipped: value is blank');
    expect(warnings[1]).toBe('CSV record 2, column 4 ("C") skipped: value is not a finite number');
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
    expect(data.errors).toEqual([]);
    expect(data.warnings).toEqual([]);
  });

  it('returns an empty result carrying the errors for unusable input', () => {
    const data = buildPlotData('');
    expect(data.series).toEqual([]);
    expect(data.valueHeader).toBeNull();
    expect(data.errors).toEqual(['CSV input must be nonempty text']);
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

  it('warns about an unknown xType and returns no series', () => {
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
  ])('warns about invalid xColumns: %s', (_, xColumns) => {
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
    // A lone bad value leaves no observations, so the file is rejected and series is empty.
    const y = value => buildPlotData(`V,X\nAna,${value}`).series[0]?.points[0]?.[1];

    it.each([['5', 5], [' 5 ', 5], ['.5', 0.5], ['5.', 5], ['+5', 5], ['-2.5', -2.5], ['1e3', 1000], ['0', 0]])(
      'accepts %j', (raw, expected) => expect(y(raw)).toBe(expected));

    it.each(['abc', '1,000', '0x10', 'NaN', 'Infinity', '1e999', '--1'])(
      'rejects %j', raw => expect(y(raw)).toBeUndefined());
  });

  it('leaves out skipped cells but keeps the rest of the row', () => {
    const { series, warnings } = buildPlotData('V,A,B,C\nAna,1,,x');
    expect(series).toEqual([{ group: 'Ana', points: [[0, 1]] }]);
    expect(warnings).toHaveLength(2);
  });

  it('keeps case-sensitive group names distinct', () => {
    const { series } = buildPlotData('V,A,B\n Ana ,1,2\nana,3,4');
    expect(series.map(s => s.group).sort()).toEqual(['Ana', 'ana']);
  });

  it('sorts series by group name', () => {
    const { series } = buildPlotData('V,A\nZed,1\nAmy,2\nMia,3');
    expect(series.map(s => s.group)).toEqual(['Amy', 'Mia', 'Zed']);
  });
});

describe('bundled datasets', () => {
  const examples = new URL('../data/examples/', import.meta.url);
  const paths = [
    ...readdirSync(examples).filter(name => name.endsWith('.csv')).map(name => new URL(name, examples)),
    new URL('../data/DATA - Step Count.csv', import.meta.url),
    new URL('../data/DATA - Hours of Sleep.csv', import.meta.url),
  ];

  it('includes the example files', () => {
    expect(paths.length).toBeGreaterThan(2);
  });

  it.each(paths.map(url => [decodeURIComponent(url.pathname.split('/').pop()), url]))(
    '%s is valid, with only blank-cell warnings', (_, url) => {
      const data = buildPlotData(readFileSync(url, 'utf8'));
      expect(data.errors).toEqual([]);
      expect(data.series.length).toBeGreaterThan(0);
      expect(data.valueHeader).toBeTruthy();
      for (const warning of data.warnings) expect(warning).toMatch(/value is blank$/);
    });
});
