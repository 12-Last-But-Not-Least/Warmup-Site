// @ts-check
/**
 * Statistical helpers for the chart's least-squares trend line and Pearson correlation.
 * Inputs are numeric coordinate pairs; undefined fits and correlations return NaN.
 * @module stats
 */

/**
 * One numeric coordinate pair used in statistical calculations.
 * @typedef {Object} XY
 * @property {number} x - X coordinate of the observation.
 * @property {number} y - Y coordinate of the observation.
 */

/**
 * Calculate the least-squares line y = slope * x + intercept.
 * Returns NaN for both values when there are fewer than two points
 * or all points have the same X coordinate.
 * @param {XY[]} points - Numeric observations used to fit the line.
 * @returns {{slope: number, intercept: number}} The fitted line's slope and Y-axis intercept.
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
 * Calculate the Pearson correlation coefficient between X and Y values.
 * Returns NaN when there are fewer than two points, all X values are equal,
 * or all Y values are equal.
 * @param {XY[]} points - Numeric observations used to calculate the correlation.
 * @returns {number} Correlation coefficient from -1 to 1, or NaN when undefined.
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
