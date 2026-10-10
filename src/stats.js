// @ts-check
/**
 * Simple statistics helpers used by the chart (trend line + correlation).
 * Placeholder version — the stats owner can swap in their own as long as the
 * signatures stay the same.
 */

/**
 * @typedef {{x: number, y: number}} XY
 */

/**
 * Ordinary least-squares fit y = slope * x + intercept.
 * Returns NaN for both when the fit is undefined (fewer than 2 points, or all x equal).
 * @param {XY[]} points
 * @returns {{slope: number, intercept: number}}
 */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return { slope: NaN, intercept: NaN };

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - meanX) * (p.y - meanY);
    sxx += (p.x - meanX) ** 2;
  }
  if (sxx === 0) return { slope: NaN, intercept: NaN };

  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Pearson correlation coefficient r in [-1, 1].
 * Returns NaN when undefined (fewer than 2 points, or zero variance in x or y).
 * @param {XY[]} points
 * @returns {number}
 */
export function pearson(points) {
  const n = points.length;
  if (n < 2) return NaN;

  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}
