import { describe, expect, it } from 'vitest';
import { linearFit, pearson } from '../src/stats.js';

const pts = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

describe('linearFit', () => {
  it('is undefined for fewer than two points', () => {
    expect(linearFit([])).toEqual({ slope: NaN, intercept: NaN });
    expect(linearFit(pts([1, 2]))).toEqual({ slope: NaN, intercept: NaN });
  });

  it('is undefined when every x is equal', () => {
    expect(linearFit(pts([2, 1], [2, 5]))).toEqual({ slope: NaN, intercept: NaN });
  });

  it('recovers an exact line', () => {
    const { slope, intercept } = linearFit(pts([0, 1], [1, 3], [2, 5]));
    expect(slope).toBeCloseTo(2);
    expect(intercept).toBeCloseTo(1);
  });

  it('gives a zero slope for flat data', () => {
    const { slope, intercept } = linearFit(pts([0, 4], [1, 4], [2, 4]));
    expect(slope).toBeCloseTo(0);
    expect(intercept).toBeCloseTo(4);
  });

  it('handles a negative slope', () => {
    expect(linearFit(pts([0, 10], [5, 0])).slope).toBeCloseTo(-2);
  });

  it('fits noisy data by least squares', () => {
    // Known result: y = 0.6x + 2.2
    const { slope, intercept } = linearFit(pts([1, 2], [2, 4], [3, 5], [4, 4], [5, 5]));
    expect(slope).toBeCloseTo(0.6);
    expect(intercept).toBeCloseTo(2.2);
  });
});

describe('pearson', () => {
  it('is undefined for fewer than two points', () => {
    expect(pearson([])).toBeNaN();
    expect(pearson(pts([1, 1]))).toBeNaN();
  });

  it('is undefined with zero variance in x or y', () => {
    expect(pearson(pts([1, 1], [1, 2]))).toBeNaN();
    expect(pearson(pts([1, 3], [2, 3]))).toBeNaN();
  });

  it('is 1 for a perfect positive relationship', () => {
    expect(pearson(pts([1, 2], [2, 4], [3, 6]))).toBeCloseTo(1);
  });

  it('is -1 for a perfect negative relationship', () => {
    expect(pearson(pts([1, 6], [2, 4], [3, 2]))).toBeCloseTo(-1);
  });

  it('is 0 for uncorrelated data', () => {
    expect(pearson(pts([-1, 1], [0, 0], [1, 1]))).toBeCloseTo(0);
  });

  it('matches a known value', () => {
    // sxy = 6, sxx = 10, syy = 6 -> r = 6 / sqrt(60)
    expect(pearson(pts([1, 2], [2, 4], [3, 5], [4, 4], [5, 5]))).toBeCloseTo(6 / Math.sqrt(60));
  });
});
