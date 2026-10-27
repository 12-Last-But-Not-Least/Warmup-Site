import { describe, expect, it } from 'vitest';
import {
  colorFor, computeMeans, formatTick, formatValue, linearScale, niceStep, niceTicks,
  paddedExtent, shapePath, stableNoise,
} from '../src/chart.js';

describe('linearScale', () => {
  it('maps and inverts', () => {
    const s = linearScale([0, 10], [100, 200]);
    expect(s.map(0)).toBe(100);
    expect(s.map(5)).toBe(150);
    expect(s.invert(175)).toBe(7.5);
  });

  it('supports an inverted range (SVG y axis)', () => {
    const s = linearScale([0, 1], [300, 0]);
    expect(s.map(0.5)).toBe(150);
    expect(s.invert(300)).toBe(0);
  });

  it('extrapolates outside the domain', () => {
    expect(linearScale([0, 1], [0, 10]).map(2)).toBe(20);
  });

  it('is not finite for a zero-width domain', () => {
    expect(Number.isFinite(linearScale([3, 3], [0, 10]).map(4))).toBe(false);
  });
});

describe('niceStep', () => {
  it.each([
    [10, 10, 1], [14, 10, 1], [16, 10, 2], [29, 10, 2], [31, 10, 5], [69, 10, 5], [71, 10, 10],
    [1000, 5, 200], [0.5, 5, 0.1],
  ])('niceStep(%d, %d) = %d', (span, count, expected) => {
    expect(niceStep(span, count)).toBeCloseTo(expected);
  });

  it('treats a count below one as one', () => {
    expect(niceStep(10, 0)).toBe(10);
  });

  it('collapses to a zero step for a zero span (callers pad the extent first)', () => {
    expect(niceStep(0, 5)).toBe(0);
  });
});

describe('niceTicks', () => {
  it('returns multiples of the step inside the range', () => {
    const { ticks, step } = niceTicks(0, 100, 5);
    expect(step).toBe(20);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('excludes ticks outside a non-aligned range', () => {
    expect(niceTicks(3, 47, 5).ticks).toEqual([10, 20, 30, 40]);
  });

  it('handles negative ranges without float drift', () => {
    const { ticks, step } = niceTicks(-50, 50, 4);
    expect(step).toBe(20);
    expect(ticks).toEqual([-40, -20, 0, 20, 40]);
  });

  it('produces evenly spaced multiples for fractional steps', () => {
    const { ticks, step } = niceTicks(0, 1, 5);
    expect(step).toBeCloseTo(0.2);
    expect(ticks.map(t => Math.round(t * 10) / 10)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
});

describe('formatting', () => {
  it('formatTick uses just enough decimals for the step', () => {
    expect(formatTick(5, 1)).toBe('5');
    expect(formatTick(0.5, 0.1)).toBe('0.5');
    expect(formatTick(0.25, 0.05)).toBe('0.25');
    expect(formatTick(2500, 500)).toBe((2500).toLocaleString());
  });

  it('formatValue keeps at most two decimals', () => {
    expect(formatValue(1.23456)).toBe((1.23).toLocaleString(undefined, { maximumFractionDigits: 2 }));
    expect(formatValue(3)).toBe('3');
  });
});

describe('paddedExtent', () => {
  it('pads each side by 6% of the span', () => {
    const [lo, hi] = paddedExtent([0, 100]);
    expect(lo).toBeCloseTo(-6);
    expect(hi).toBeCloseTo(106);
  });

  it('widens a single value to a unit either side before padding', () => {
    const [lo, hi] = paddedExtent([5, 5, 5]);
    expect(lo).toBeLessThan(4);
    expect(hi).toBeGreaterThan(6);
  });

  it('accepts a custom pad', () => {
    expect(paddedExtent([0, 10], 0.5)).toEqual([-5, 15]);
  });
});

describe('stableNoise', () => {
  it('is deterministic and within [-1, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const n = stableNoise(i);
      expect(n).toBe(stableNoise(i));
      expect(n).toBeGreaterThanOrEqual(-1);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('varies by index', () => {
    expect(new Set([0, 1, 2, 3, 4].map(stableNoise)).size).toBe(5);
  });
});

describe('colorFor', () => {
  it('uses series variables for the first eight slots then the fallback', () => {
    expect(colorFor(0)).toBe('var(--series-1)');
    expect(colorFor(7)).toBe('var(--series-8)');
    expect(colorFor(8)).toBe('var(--series-other)');
  });
});

describe('shapePath', () => {
  it('draws a distinct shape per slot where it matters', () => {
    expect(shapePath(0, 5)).toContain('A');          // circle
    expect(shapePath(1, 5)).toMatch(/^M-4\.5,-4\.5H4\.5V4\.5H-4\.5Z$/); // square
    expect(shapePath(2, 5)).toMatch(/^M0,-6\.25L/);  // triangle
    expect(shapePath(3, 5)).toMatch(/^M0,-6\.25L6\.25,0/); // diamond
    expect(shapePath(7, 5)).toMatch(/Z$/);           // cross
    expect(new Set([0, 1, 2, 3, 7].map(s => shapePath(s, 5))).size).toBe(5);
  });

  it('falls back to a circle beyond the defined slots', () => {
    expect(shapePath(8, 5)).toBe(shapePath(0, 5));
    expect(shapePath(100, 5)).toBe(shapePath(0, 5));
  });
});

describe('computeMeans', () => {
  const mark = (x, y) => ({ point: { x, y } });

  it('averages y per distinct x', () => {
    expect(computeMeans([mark(0, 2), mark(0, 4), mark(1, 10)])).toEqual([
      { x: 0, y: 3, n: 2 },
      { x: 1, y: 10, n: 1 },
    ]);
  });

  it('returns nothing for no marks', () => {
    expect(computeMeans([])).toEqual([]);
  });
});
