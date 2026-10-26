import { describe, expect, it } from 'vitest';
import { buildPlotData } from '../src/data.js';
import { toLineInput, toScatterInput } from '../src/transform.js';

describe('toLineInput', () => {
  it('titles the chart with the value header and connects groups', () => {
    const input = toLineInput(buildPlotData('Steps,Mon,Tue\nAna,1,2\nBen,3,4'), 'file.csv');
    expect(input).toEqual({
      title: 'Steps',
      xLabel: '',
      yLabel: 'Steps',
      points: [
        { x: 0, y: 1, group: 'Ana' }, { x: 1, y: 2, group: 'Ana' },
        { x: 0, y: 3, group: 'Ben' }, { x: 1, y: 4, group: 'Ben' },
      ],
      xTickLabels: { 0: 'Mon', 1: 'Tue' },
      connectGroups: true,
    });
  });

  it('falls back to the file name when there is no header', () => {
    const input = toLineInput(buildPlotData(''), 'empty.csv');
    expect(input.title).toBe('empty.csv');
    expect(input.points).toEqual([]);
  });
});

describe('toScatterInput', () => {
  const a = buildPlotData('Steps,Mon,Tue\nAna,10,20\nBen,30,40');

  it('pairs a-values on Y with b-values on X by group and header', () => {
    const b = buildPlotData('Sleep,Mon,Tue\nAna,7,8\nBen,6,5');
    const input = toScatterInput(a, b);
    expect(input.title).toBe('Steps vs. Sleep');
    expect(input.xLabel).toBe('Sleep');
    expect(input.yLabel).toBe('Steps');
    expect(input.showTrend).toBe(true);
    expect(input.points).toEqual([
      { x: 7, y: 10, group: 'Ana' }, { x: 8, y: 20, group: 'Ana' },
      { x: 6, y: 30, group: 'Ben' }, { x: 5, y: 40, group: 'Ben' },
    ]);
  });

  it('matches by header text when column order differs', () => {
    const b = buildPlotData('Sleep,Tue,Mon\nAna,8,7\nBen,5,6');
    const { points } = toScatterInput(a, b);
    expect(points).toContainEqual({ x: 7, y: 10, group: 'Ana' }); // Ana Mon
    expect(points).toContainEqual({ x: 8, y: 20, group: 'Ana' }); // Ana Tue
  });

  it('drops points with no partner in the other file', () => {
    const b = buildPlotData('Sleep,Mon,Wed\nAna,7,9\nCy,1,1');
    expect(toScatterInput(a, b).points).toEqual([{ x: 7, y: 10, group: 'Ana' }]);
  });

  it('drops points whose partner cell was blank', () => {
    const b = buildPlotData('Sleep,Mon,Tue\nAna,,8\nBen,6,5');
    const { points } = toScatterInput(a, b);
    expect(points).not.toContainEqual(expect.objectContaining({ group: 'Ana', y: 10 }));
    expect(points).toHaveLength(3);
  });

  it('does not confuse a group name with an x header', () => {
    const b = buildPlotData('V,x\n"a,b",1');
    const c = buildPlotData('V,x\n"a,b",2');
    expect(toScatterInput(b, c).points).toEqual([{ x: 2, y: 1, group: 'a,b' }]);
  });

  it('uses generic names when headers are missing', () => {
    const empty = buildPlotData('');
    const input = toScatterInput(empty, empty);
    expect(input.title).toBe('File 1 vs. File 2');
    expect(input.points).toEqual([]);
  });

  it('pairs numeric x values by value', () => {
    const n1 = buildPlotData('V,1,2\nAna,5,6', { xType: 'number' });
    const n2 = buildPlotData('W,2,1\nAna,9,8', { xType: 'number' });
    expect(toScatterInput(n1, n2).points).toEqual([{ x: 8, y: 5, group: 'Ana' }, { x: 9, y: 6, group: 'Ana' }]);
  });
});
