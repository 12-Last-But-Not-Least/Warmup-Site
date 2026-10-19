// @ts-check
/**
 * Axis scales and ticks. Pure functions, no DOM, so they can be unit-tested.
 *
 * A scale works in "t-space": the data value itself for a linear axis, log10 of
 * the value for a log axis. Views, panning and zooming are all expressed in
 * t-space, so they are plain linear arithmetic whichever scale is active.
 */

/** @typedef {'linear' | 'log'} ScaleKind */

/**
 * @typedef {Object} Scale
 * @property {ScaleKind} kind
 * @property {(v: number) => number} map        data value -> pixel (NaN if not representable)
 * @property {(px: number) => number} invert    pixel -> data value
 * @property {(px: number) => number} invertT   pixel -> t-space value
 */

/** @param {ScaleKind} kind @param {number} v */
export function toT(kind, v) {
  return kind === 'log' ? (v > 0 ? Math.log10(v) : NaN) : v;
}

/** @param {ScaleKind} kind @param {number} t */
export function fromT(kind, t) {
  return kind === 'log' ? 10 ** t : t;
}

/**
 * Whether a data value can be drawn on an axis of this kind.
 * @param {ScaleKind} kind
 * @param {number} v
 */
export function isPlottable(kind, v) {
  return Number.isFinite(v) && (kind !== 'log' || v > 0);
}

/**
 * Map from a t-space domain to a pixel range, for the given axis kind.
 * @param {ScaleKind} kind
 * @param {[number, number]} tDomain
 * @param {[number, number]} range
 * @returns {Scale}
 */
export function makeScale(kind, tDomain, range) {
  const [d0, d1] = tDomain;
  const [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0);
  const invertT = (/** @type {number} */ px) => d0 + (px - r0) / k;
  return {
    kind,
    map: (v) => r0 + (toT(kind, v) - d0) * k,
    invert: (px) => fromT(kind, invertT(px)),
    invertT,
  };
}

/**
 * Linear map from a data domain to a pixel range.
 * @param {[number, number]} domain
 * @param {[number, number]} range
 */
export function linearScale(domain, range) {
  return makeScale('linear', domain, range);
}

/**
 * A "nice" step (1, 2 or 5 times a power of ten) giving roughly `count` intervals.
 * @param {number} span
 * @param {number} count
 */
export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/**
 * Tick values at multiples of a nice step inside [min, max].
 * @param {number} min
 * @param {number} max
 * @param {number} count  desired number of intervals
 * @returns {{ticks: number[], step: number}}
 */
export function niceTicks(min, max, count) {
  const step = niceStep(max - min, count);
  const ticks = [];
  // Integer loop avoids floating-point drift from repeated addition.
  for (let i = Math.ceil(min / step); i <= Math.floor(max / step); i++) {
    ticks.push(i * step);
  }
  return { ticks, step };
}

/**
 * How many categories to step between labels so the widest one doesn't
 * overlap its neighbour: 1 shows every label, 3 shows every third.
 * A degenerate axis (no width) shows every label rather than hiding them.
 * @param {number} pxPerUnit    pixels between neighbouring categories
 * @param {number} widestLabelPx
 * @param {number} [gapPx]      minimum space between labels
 */
export function categoryLabelStep(pxPerUnit, widestLabelPx, gapPx = 8) {
  if (!(pxPerUnit > 0)) return 1;
  return Math.max(1, Math.ceil((widestLabelPx + gapPx) / pxPerUnit));
}

/**
 * Tick values for a log axis whose visible t-space range is [tMin, tMax].
 * Always powers of ten; intermediate 2 and 5 (or 1-9) are added when few
 * decades are visible so the axis never looks empty.
 * @param {number} tMin
 * @param {number} tMax
 * @param {number} [maxTicks]
 * @returns {number[]}  data values, ascending
 */
export function logTicks(tMin, tMax, maxTicks = 8) {
  const span = tMax - tMin;
  let mults = [1];
  if (span < 1.5) mults = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  else if (span < 3.5) mults = [1, 2, 5];
  const decadeStep = Math.max(1, Math.ceil(span / maxTicks));

  /** @type {number[]} */
  const out = [];
  const first = Math.floor(tMin);
  for (let k = Math.floor(first / decadeStep) * decadeStep; k <= Math.ceil(tMax); k += decadeStep) {
    for (const m of mults) {
      const v = m * 10 ** k;
      const t = Math.log10(v);
      if (t >= tMin - 1e-9 && t <= tMax + 1e-9) out.push(v);
    }
  }
  return out;
}

/**
 * Label for a log-axis tick: plain numbers for moderate sizes, 1e6-style otherwise.
 * @param {number} v
 */
export function formatLogTick(v) {
  const exp = Math.floor(Math.log10(v) + 1e-9);
  if (exp >= 6 || exp <= -4) {
    const mant = v / 10 ** exp;
    return `${Number(mant.toPrecision(3))}e${exp}`;
  }
  return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Format a linear tick value with just enough decimals for the tick step.
 * @param {number} v
 * @param {number} step
 */
export function formatTick(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * t-space extent of data values, padded so points don't sit on the frame.
 * Values that can't be drawn on this axis kind are ignored.
 * @param {ScaleKind} kind
 * @param {number[]} values  data values
 * @param {number} [pad]
 * @returns {[number, number]}
 */
export function paddedExtent(kind, values, pad = 0.06) {
  const ts = values.filter((v) => isPlottable(kind, v)).map((v) => toT(kind, v));
  if (ts.length === 0) return [0, 1];
  let min = Math.min(...ts);
  let max = Math.max(...ts);
  if (min === max) { min -= 1; max += 1; }
  const p = (max - min) * pad;
  return [min - p, max + p];
}
