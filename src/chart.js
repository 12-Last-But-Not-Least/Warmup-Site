// @ts-check
/**
 * Scatter plot library: scales, ticks, axes, points, legend, tooltip, zoom/pan.
 * Plain SVG, retained mode, no chart libraries. Knows nothing about the data's
 * meaning — everything comes from the PlotInput.
 *
 * Interaction: hover for a tooltip (nearest point), drag to pan,
 * Ctrl/⌘ + scroll (or trackpad pinch) to zoom, double-click or "Reset" to restore.
 * @module chart
 */
import { linearFit, pearson } from './stats.js';

/**
 * One data point on the chart.
 * @typedef {Object} Point
 * @property {number} x - X-axis coordinate.
 * @property {number} y - Y-axis coordinate.
 * @property {string} [group] - Group name used to select the marker color and shape.
 */

/**
 * Data and display settings for one chart.
 * @typedef {Object} PlotInput
 * @property {string} title - Title displayed above the chart.
 * @property {string} xLabel - X-axis title; an empty string hides the title.
 * @property {string} yLabel - Y-axis title; an empty string hides the title.
 * @property {Point[]} points - Data points to display on the chart.
 * @property {Object<number, string>} [xTickLabels] - Labels for X-axis positions, such as 0: "Monday".
 * @property {boolean} [showTrend=false] - Draw a linear regression line and display the Pearson correlation coefficient.
 * @property {boolean} [showMeans=false] - Draw a mean Y-value marker at each distinct X position.
 * @property {number} [jitter=0] - Horizontal offset amount in X-axis units used to separate overlapping points; ignored when connectGroups is true.
 * @property {boolean} [connectGroups=false] - Connect each group's points with a line in X-coordinate order.
 */

/**
 * @typedef {Object} Scale
 * @property {function(number): number} map - Convert a data value to pixels.
 * @property {function(number): number} invert - Convert pixels to a data value.
 */

/**
 * Drawing information for one data point.
 * @typedef {Object} Mark
 * @property {Point} point - Original data point before jitter is applied.
 * @property {string} group - Group name, or an empty string when no group is specified.
 * @property {number} slot - Zero-based group index used to select the marker color and shape.
 * @property {number} x - X coordinate used for drawing, including any horizontal jitter.
 * @property {number} y - Y coordinate used for drawing.
 * @property {SVGPathElement} [el] - SVG path element representing the marker, assigned during rendering.
 */

/**
 * Mean Y value for data points sharing the same X coordinate.
 * @typedef {Object} Mean
 * @property {number} x - Shared X coordinate of the data points.
 * @property {number} y - Mean Y value of those data points.
 * @property {number} n - Number of data points included in the mean.
 */

/**
 * A chart item found near the pointer.
 * When kind is 'point', mark contains the individual point's drawing information.
 * When kind is 'mean', mean contains the mean marker's position, value, and count.
 * Used to choose the tooltip content and hover indicator.
 * @typedef {{kind: 'point', mark: Mark} | {kind: 'mean', mean: Mean}} Hit
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = { top: 20, right: 24, bottom: 52, left: 72 };
const HEIGHT = 360;
const POINT_R = 5;            // 10px markers
const HIT_RADIUS = 24;        // px; hover target is much bigger than the mark
const MEAN_HALF_WIDTH = 0.3;  // x units each side of the mean bar
const SERIES_SLOTS = 8;       // colors defined in styles.css (--series-1..8)

// Secondary encoding: 8 colors can't all be told apart in one scatter
// (especially with color-vision deficiency), so each slot also gets a shape.
// Chosen so the most confusable color pairs (orange/red/green, blue/violet,
// aqua/green, orange/yellow) never share a shape.
//                   blue      orange    aqua        yellow     magenta     green     violet     red
const SLOT_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'triangle', 'circle', 'diamond', 'cross'];

let instanceCounter = 0; // for unique clipPath ids when several charts share a page

// ---------------------------------------------------------------------------
// Scales and ticks (exported so they can be unit-tested)
// ---------------------------------------------------------------------------

/**
 * Linear map from a data domain to a pixel range.
 * @param {number[]} domain - Two data bounds: [minimum, maximum].
 * @param {number[]} range - Two pixel bounds: [start, end].
 * @returns {Scale}
 */
export function linearScale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = (r1 - r0) / (d1 - d0);
  return {
    map: (v) => r0 + (v - d0) * k,
    invert: (px) => d0 + (px - r0) / k,
  };
}

/**
 * Calculate a readable tick interval using 1, 2, or 5 times a power of ten.
 * @param {number} span - Width of the axis range, calculated as maximum minus minimum.
 * @param {number} count - Desired number of intervals across the axis range.
 * @returns {number} Tick interval chosen to produce approximately the desired number of intervals.
 */
export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/**
 * Calculate readable tick values within the inclusive range [min, max].
 * @param {number} min - Lower bound of the axis range.
 * @param {number} max - Upper bound of the axis range.
 * @param {number} count - Desired number of intervals across the axis range.
 * @returns {{ticks: number[], step: number}} An object containing ticks, the tick values in ascending order, and step, the interval between ticks.
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
 * Format an axis tick value using decimal places determined by the tick interval.
 * @param {number} v - Numeric tick value to format.
 * @param {number} step - Tick interval used to determine the number of decimal places.
 * @returns {string} Tick label formatted using the user's locale.
 */
function formatTick(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Format a data value for display in tooltips and data tables.
 * @param {number} v - Numeric value to format.
 * @returns {string} Value formatted using the user's locale, with at most two decimal places.
 */
function formatValue(v) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Data extent padded on both sides so points don't sit on the frame.
 * @param {number[]} values - Data values used to calculate the bounds.
 * @param {number} [pad=0.06] - Padding on each side as a fraction of the span.
 * @returns {number[]} Two padded bounds in order: [minimum, maximum].
 */
function paddedExtent(values, pad = 0.06) {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const p = (max - min) * pad;
  return [min - p, max + p];
}

/**
 * Generate a deterministic pseudo-random value between -1 and 1.
 * The same index always produces the same value, keeping horizontal jitter
 * stable when the chart is redrawn during zooming or panning.
 * @param {number} i - Zero-based index of the data point.
 * @returns {number} Pseudo-random value used to calculate the point's horizontal offset.
 */
function stableNoise(i) {
  const s = Math.sin((i + 1) * 12.9898) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

/**
 * Create an SVG element, set its attributes, and optionally append it to a parent.
 * @param {string} tag - SVG tag name, such as 'line', 'text', or 'path'.
 * @param {Record<string, string|number>} [attrs] - Attribute names and values to assign to the element.
 * @param {Element} [parent] - Parent element to append the new element to; if omitted, the element remains unattached.
 * @returns {any} The created SVG element; typed loosely so callers can use properties specific to its tag.
 */
function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Create an HTML element with an optional CSS class and text content.
 * The tag parameter is an HTML tag name, such as 'div', 'button', or 'table'.
 * K represents the supplied tag name.
 * Returns the corresponding HTML element, such as a button element for 'button'.
 * The caller is responsible for adding the element to the page.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag - HTML tag name that determines the element to create.
 * @param {string} [className] - CSS class name to assign to the element.
 * @param {string} [text] - Text content to display inside the element.
 */
function htmlEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Select a marker or line color for a group slot.
 * @param {number} slot - Zero-based group index used to select a series color.
 * @returns {string} CSS variable reference for the selected color, or the fallback color for slots beyond the eight defined series colors.
 */
function colorFor(slot) {
  return slot < SERIES_SLOTS ? `var(--series-${slot + 1})` : 'var(--series-other)';
}

/**
 * Create SVG path data for a marker shape centered at (0, 0).
 * The caller positions the marker using an SVG transform.
 * @param {number} slot - Zero-based group index used to select the marker shape; slots beyond the eight defined series use a circle.
 * @param {number} r - Base marker size in SVG units; each shape scales its dimensions from this value.
 * @returns {string} SVG path commands to use as a path element's d attribute.
 */
function shapePath(slot, r) {
  const shape = slot < SERIES_SLOTS ? SLOT_SHAPES[slot] : 'circle';
  switch (shape) {
    case 'square': {
      const s = r * 0.9;
      return `M${-s},${-s}H${s}V${s}H${-s}Z`;
    }
    case 'triangle': {
      const h = r * 1.25;
      return `M0,${-h}L${h},${h * 0.75}L${-h},${h * 0.75}Z`;
    }
    case 'diamond': {
      const d = r * 1.25;
      return `M0,${-d}L${d},0L0,${d}L${-d},0Z`;
    }
    case 'cross': {
      const a = r * 1.1;
      const b = r * 0.38;
      return `M${-b},${-a}H${b}V${-b}H${a}V${b}H${b}V${a}H${-b}V${b}H${-a}V${-b}H${-b}Z`;
    }
    default:
      return `M${-r},0A${r},${r} 0 1,0 ${r},0A${r},${r} 0 1,0 ${-r},0Z`;
  }
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

/**
 * Render an interactive scatter plot into the container, replacing its contents.
 * @param {HTMLElement} container - HTML element in which to display the chart.
 * @param {PlotInput} input - Chart data and settings, including points, title, axis labels, and display options.
 * @returns {void} Updates the container without returning a value.
 */
export function drawScatter(container, input) {
  const { title, xLabel, yLabel, xTickLabels, showTrend = false, showMeans = false, connectGroups = false } = input;
  // Jitter would make lines zig-zag sideways, so lines always plot at the exact x.
  const jitter = connectGroups ? 0 : input.jitter ?? 0;
  const points = input.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const id = ++instanceCounter;

  container.replaceChildren();
  container.classList.add('scatter');
  container.append(htmlEl('h2', 'scatter-title', title));

  if (points.length === 0) {
    container.append(htmlEl('p', 'scatter-empty', 'No data to plot.'));
    return;
  }

  // Groups are sorted by name so the same person gets the same color and
  // shape on every chart, regardless of input order.
  const groups = [...new Set(points.map((p) => p.group ?? ''))].sort();
  const hasGroups = groups.length > 1 || groups[0] !== '';

  /** @type {Mark[]} */
  const marks = points.map((p, i) => ({
    point: p,
    group: p.group ?? '',
    slot: groups.indexOf(p.group ?? ''),
    x: p.x + jitter * stableNoise(i),
    y: p.y,
  }));

  // Initial ("home") view. With tick labels (categorical-ish x), give each
  // labeled position half a unit of room on either side.
  const xs = points.map((p) => p.x);
  /** 
  * Initial X-axis bounds in order: [minimum, maximum].
  * @type {number[]}
  */
  let homeX;
  if (xTickLabels) {
    const keys = Object.keys(xTickLabels).map(Number).concat(xs);
    homeX = [Math.min(...keys) - 0.5, Math.max(...keys) + 0.5];
  } else {
    homeX = paddedExtent(xs);
  }
  const homeY = paddedExtent(points.map((p) => p.y));
  let view = { x: homeX, y: homeY };

/**
 * Groups switched off in the legend.
 * @type {Set<string>}
 */
const hidden = new Set();
/**
 * Group being hovered in the legend.
 * @type {string|null}
 */
let highlighted = null;

  // ---- DOM skeleton -------------------------------------------------------
  const legend = htmlEl('div', 'scatter-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', `${title} legend`);

  const toolbar = htmlEl('div', 'scatter-toolbar');
  const hint = htmlEl('span', 'scatter-hint', 'Drag to pan · Ctrl/⌘ + scroll to zoom · double-click to reset');
  const resetBtn = htmlEl('button', 'scatter-reset', 'Reset view');
  resetBtn.type = 'button';
  toolbar.append(hint, resetBtn);

  const plot = htmlEl('div', 'scatter-plot');
  /** @type {SVGSVGElement} */
  const svg = svgEl('svg', { role: 'img', 'aria-label': `${title}: ${yLabel} against ${xLabel}` });
  const tooltip = htmlEl('div', 'scatter-tooltip');
  tooltip.hidden = true;
  plot.append(svg, tooltip);

  container.append(legend, toolbar, plot, buildTable());

  // ---- Render state read by the event handlers ----------------------------
  let plotW = 0;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  /** @type {Scale} */ let sx = linearScale(view.x, [0, 1]);
  /** @type {Scale} */ let sy = linearScale(view.y, [0, 1]);
  /** @type {Mark[]} */ let visibleMarks = [];
  /** @type {Mean[]} */ let means = [];
  /** @type {SVGCircleElement | null} */ let hoverRing = null;
 /**
 * One line per group when connectGroups is enabled.
 * @type {Map<string, SVGPathElement>}
 */
let lines = new Map();

  /** Rebuild the whole SVG for the current view. Cheap: data is small. */
  function render() {
    const width = Math.max(320, plot.clientWidth || 640);
    plotW = width - MARGIN.left - MARGIN.right;
    const left = MARGIN.left;
    const right = MARGIN.left + plotW;
    const top = MARGIN.top;
    const bottom = MARGIN.top + plotH;

    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(HEIGHT));
    svg.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    svg.replaceChildren();

    sx = linearScale(view.x, [left, right]);
    sy = linearScale(view.y, [bottom, top]); // SVG y grows downward

    const clipId = `scatter-clip-${id}`;
    const defs = svgEl('defs', {}, svg);
    svgEl('rect', { x: left, y: top, width: plotW, height: plotH }, svgEl('clipPath', { id: clipId }, defs));

    // -- Grid and tick labels --
    const grid = svgEl('g', { class: 'grid' }, svg);
    const axis = svgEl('g', { class: 'axis' }, svg);

    const yTicks = niceTicks(view.y[0], view.y[1], Math.max(2, Math.round(plotH / 56)));
    for (const v of yTicks.ticks) {
      const y = sy.map(v);
      svgEl('line', { x1: left, x2: right, y1: y, y2: y }, grid);
      const t = svgEl('text', { x: left - 8, y, class: 'tick-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, axis);
      t.textContent = formatTick(v, yTicks.step);
    }

    /** 
     * X-axis ticks, each containing a position and a display label.
     * @type {Array.<{v: number, text: string}>}
    */
    let xTicks;
    if (xTickLabels) {
      xTicks = Object.entries(xTickLabels)
        .map(([k, text]) => ({ v: Number(k), text }))
        .filter((t) => t.v >= view.x[0] && t.v <= view.x[1]);
    } else {
      const nt = niceTicks(view.x[0], view.x[1], Math.max(2, Math.round(plotW / 90)));
      xTicks = nt.ticks.map((v) => ({ v, text: formatTick(v, nt.step) }));
    }
    for (const { v, text } of xTicks) {
      const x = sx.map(v);
      svgEl('line', { x1: x, x2: x, y1: top, y2: bottom }, grid);
      const t = svgEl('text', { x, y: bottom + 18, class: 'tick-label', 'text-anchor': 'middle' }, axis);
      t.textContent = text;
    }

    // Axis baselines and titles
    svgEl('line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'baseline' }, axis);
    svgEl('line', { x1: left, x2: left, y1: top, y2: bottom, class: 'baseline' }, axis);
    if (xLabel) {
      svgEl('text', { x: (left + right) / 2, y: HEIGHT - 10, class: 'axis-title', 'text-anchor': 'middle' }, axis).textContent = xLabel;
    }
    if (yLabel) {
      svgEl('text', {
        x: -(top + bottom) / 2, y: 18, class: 'axis-title', 'text-anchor': 'middle', transform: 'rotate(-90)',
      }, axis).textContent = yLabel;
    }

    // -- Data (clipped to the plot area so zoom/pan doesn't spill over axes) --
    const data = svgEl('g', { 'clip-path': `url(#${clipId})` }, svg);
    visibleMarks = marks.filter((m) => !hidden.has(m.group));

    if (showTrend && visibleMarks.length >= 2) {
      const xy = visibleMarks.map((m) => ({ x: m.point.x, y: m.point.y }));
      const { slope, intercept } = linearFit(xy);
      if (Number.isFinite(slope)) {
        const [x0, x1] = view.x;
        svgEl('line', {
          class: 'trend',
          x1: sx.map(x0), y1: sy.map(slope * x0 + intercept),
          x2: sx.map(x1), y2: sy.map(slope * x1 + intercept),
        }, data);
      }
      const r = pearson(xy);
      const label = svgEl('text', { x: right - 8, y: top + 16, class: 'corner-label', 'text-anchor': 'end' }, svg);
      label.textContent = `r = ${Number.isFinite(r) ? r.toFixed(2) : '—'}  (n = ${xy.length})`;
    }

    // Lines go under the points so the markers stay visible on top.
    lines = new Map();
    if (connectGroups) {
      for (const group of groups) {
        const pts = visibleMarks.filter((m) => m.group === group).sort((a, b) => a.x - b.x);
        if (pts.length < 2) continue;
        const d = pts.map((m, i) => `${i ? 'L' : 'M'}${sx.map(m.x)},${sy.map(m.y)}`).join('');
        lines.set(group, svgEl('path', { d, class: 'series-line', stroke: colorFor(pts[0].slot), fill: 'none' }, data));
      }
    }

    for (const m of visibleMarks) {
      m.el = svgEl('path', {
        class: 'point',
        d: shapePath(m.slot, POINT_R),
        transform: `translate(${sx.map(m.x)},${sy.map(m.y)})`,
        fill: colorFor(m.slot),
      }, data);
    }

    // Means go on top of the points so the bar is always readable.
    means = showMeans ? computeMeans(visibleMarks) : [];
    for (const mean of means) {
      const attrs = {
        x1: sx.map(mean.x - MEAN_HALF_WIDTH), x2: sx.map(mean.x + MEAN_HALF_WIDTH),
        y1: sy.map(mean.y), y2: sy.map(mean.y),
      };
      svgEl('line', { ...attrs, class: 'mean-halo' }, data);
      svgEl('line', { ...attrs, class: 'mean' }, data);
    }

    hoverRing = svgEl('circle', { class: 'hover-ring', r: POINT_R + 4, visibility: 'hidden' }, data);
    applyHighlight();
  }

  /** Dim every group except the one hovered in the legend. */
  function applyHighlight() {
    for (const m of visibleMarks) {
      m.el?.classList.toggle('dimmed', highlighted !== null && m.group !== highlighted);
    }
    for (const [group, line] of lines) {
      line.classList.toggle('dimmed', highlighted !== null && group !== highlighted);
    }
  }

  // ---- Hover / tooltip ----------------------------------------------------

  /**
   * Nearest point or mean bar within HIT_RADIUS pixels, or null.
   * Brute force is fine for a few hundred points.
   * @param {number} px
   * @param {number} py
   * @returns {Hit | null}
   */
  function nearest(px, py) {
    /** @type {Hit | null} */
    let best = null;
    let bestD = HIT_RADIUS ** 2;
    for (const mark of visibleMarks) {
      const d = (sx.map(mark.x) - px) ** 2 + (sy.map(mark.y) - py) ** 2;
      if (d < bestD) { bestD = d; best = { kind: 'point', mark }; }
    }
    for (const mean of means) {
      // Distance to the horizontal bar segment, not just its center.
      const x0 = sx.map(mean.x - MEAN_HALF_WIDTH);
      const x1 = sx.map(mean.x + MEAN_HALF_WIDTH);
      const cx = Math.min(Math.max(px, x0), x1);
      const d = (cx - px) ** 2 + (sy.map(mean.y) - py) ** 2;
      if (d < bestD) { bestD = d; best = { kind: 'mean', mean }; }
    }
    return best;
  }

  /** @param {number} x */
  function xText(x) {
    return xTickLabels?.[x] ?? formatValue(x);
  }

  /**
   * @param {Hit | null} hit
   * @param {number} px
   * @param {number} py
   */
  function showTooltip(hit, px, py) {
    if (!hit || !hoverRing) { hideTooltip(); return; }

    /** 
     * Tooltip rows, each containing two strings in order: [label, value].
     * @type {string[][]}
    */
    let rows;
    let heading;
    if (hit.kind === 'point') {
      const { mark } = hit;
      heading = hasGroups ? mark.group || '(no group)' : '';
      rows = [[xLabel, xText(mark.point.x)], [yLabel, formatValue(mark.point.y)]];
      hoverRing.setAttribute('cx', String(sx.map(mark.x)));
      hoverRing.setAttribute('cy', String(sy.map(mark.y)));
      hoverRing.setAttribute('visibility', 'visible');
    } else {
      const { mean } = hit;
      heading = 'Mean';
      rows = [[xLabel, xText(mean.x)], [yLabel, formatValue(mean.y)], ['n', String(mean.n)]];
      hoverRing.setAttribute('visibility', 'hidden');
    }

    // textContent only: group names come from user-uploaded CSVs.
    tooltip.replaceChildren();
    if (heading) tooltip.append(htmlEl('div', 'tt-heading', heading));
    for (const [k, v] of rows) {
      const row = htmlEl('div', 'tt-row');
      row.append(htmlEl('span', 'tt-key', k), htmlEl('span', 'tt-value', v));
      tooltip.append(row);
    }
    tooltip.hidden = false;

    // Place to the upper-right of the cursor; flip left near the right edge.
    const tw = tooltip.offsetWidth;
    const flip = px + 16 + tw > plot.clientWidth;
    tooltip.style.left = `${flip ? px - 16 - tw : px + 16}px`;
    tooltip.style.top = `${Math.max(0, py - tooltip.offsetHeight - 8)}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
    hoverRing?.setAttribute('visibility', 'hidden');
  }

  // ---- Zoom / pan ---------------------------------------------------------

  /** @param {MouseEvent} e */
  function localXY(e) {
    const rect = svg.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  }

  function resetView() {
    view = { x: homeX, y: homeY };
    hideTooltip();
    render();
  }

  /** 
   * State saved at the start of a drag, or null when not dragging.
   * px and py contain the pointer's starting position in pixels.
   * x and y contain axis bounds in order: [minimum, maximum].
   * @type {{px: number, py: number, x: number[], y: number[]}|null}
  */
  let drag = null;

  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('dragging');
    hideTooltip();
  });

  svg.addEventListener('pointermove', (e) => {
    if (drag) {
      // Convert the pixel delta to data units using the view at drag start.
      const dx = ((e.clientX - drag.px) * (drag.x[1] - drag.x[0])) / plotW;
      const dy = ((e.clientY - drag.py) * (drag.y[1] - drag.y[0])) / plotH;
      view = {
        x: [drag.x[0] - dx, drag.x[1] - dx],
        y: [drag.y[0] + dy, drag.y[1] + dy], // screen y is inverted
      };
      render();
      return;
    }
    const { px, py } = localXY(e);
    showTooltip(nearest(px, py), px, py);
  });

  const endDrag = () => {
    drag = null;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', hideTooltip);

  // Zoom only with Ctrl/⌘ (trackpad pinch also sets ctrlKey), so plain
  // scrolling still scrolls the page past the chart.
  svg.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const { px, py } = localXY(e);
    const f = Math.exp(e.deltaY * 0.01); // >1 zooms out, <1 zooms in

    // Keep zoom within 1/50x .. 10x of the home view.
    const span = (view.x[1] - view.x[0]) * f;
    const homeSpan = homeX[1] - homeX[0];
    if (span < homeSpan / 50 || span > homeSpan * 10) return;

    // Zoom about the cursor: the data point under it stays fixed.
    const cx = sx.invert(px);
    const cy = sy.invert(py);
    view = {
      x: [cx + (view.x[0] - cx) * f, cx + (view.x[1] - cx) * f],
      y: [cy + (view.y[0] - cy) * f, cy + (view.y[1] - cy) * f],
    };
    hideTooltip();
    render();
  }, { passive: false });

  svg.addEventListener('dblclick', resetView);
  resetBtn.addEventListener('click', resetView);

  // ---- Legend -------------------------------------------------------------
  if (hasGroups) {
    groups.forEach((group, slot) => {
      const btn = htmlEl('button', 'legend-item');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'true');
      btn.title = 'Click to show/hide';
      btn.append(markerSwatch(slot), htmlEl('span', '', group || '(no group)'));

      btn.addEventListener('click', () => {
        if (hidden.has(group)) hidden.delete(group); else hidden.add(group);
        btn.setAttribute('aria-pressed', String(!hidden.has(group)));
        hideTooltip();
        render();
      });
      const on = () => { highlighted = group; applyHighlight(); };
      const off = () => { highlighted = null; applyHighlight(); };
      btn.addEventListener('mouseenter', on);
      btn.addEventListener('focus', on);
      btn.addEventListener('mouseleave', off);
      btn.addEventListener('blur', off);
      legend.append(btn);
    });
  }
  if (showMeans) legend.append(lineKey('mean', 'Mean'));
  if (showTrend) legend.append(lineKey('trend', 'Linear fit'));

  /** @param {number} slot */
  function markerSwatch(slot) {
    const s = svgEl('svg', { width: 14, height: 14, viewBox: '-7 -7 14 14', 'aria-hidden': 'true' });
    svgEl('path', { d: shapePath(slot, POINT_R), fill: colorFor(slot), class: 'point' }, s);
    return s;
  }

  /**
   * Static legend key for a line mark (mean bar / trend line).
   * @param {string} cls
   * @param {string} text
   */
  function lineKey(cls, text) {
    const item = htmlEl('span', 'legend-key');
    const s = svgEl('svg', { width: 18, height: 14, 'aria-hidden': 'true' });
    svgEl('line', { x1: 1, x2: 17, y1: 7, y2: 7, class: cls }, s);
    item.append(s, htmlEl('span', '', text));
    return item;
  }

  // ---- Data table (accessible alternative to the picture) -----------------
  function buildTable() {
    const details = htmlEl('details', 'scatter-table');
    details.append(htmlEl('summary', '', 'Show data table'));
    const table = htmlEl('table');
    const headRow = htmlEl('tr');
    for (const h of [...(hasGroups ? ['Group'] : []), xLabel || 'X', yLabel || 'Y']) headRow.append(htmlEl('th', '', h));
    table.append(htmlEl('thead'));
    table.tHead?.append(headRow);

    const body = htmlEl('tbody');
    const sorted = [...points].sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.x - b.x);
    for (const p of sorted) {
      const tr = htmlEl('tr');
      if (hasGroups) tr.append(htmlEl('td', '', p.group ?? ''));
      tr.append(htmlEl('td', 'num', xTickLabels?.[p.x] ?? formatValue(p.x)), htmlEl('td', 'num', formatValue(p.y)));
      body.append(tr);
    }
    table.append(body);
    details.append(table);
    return details;
  }

  // ---- Initial render + re-render on width change -------------------------
  render();
  let lastWidth = plot.clientWidth;
  new ResizeObserver(() => {
    if (plot.clientWidth === lastWidth) return;
    lastWidth = plot.clientWidth;
    hideTooltip();
    render();
  }).observe(plot);
}

/**
 * Calculate the mean Y value at each distinct original X coordinate.
 * Points are combined across groups, using coordinates before jitter is applied.
 * @param {Mark[]} marks - Markers whose original data points are used to calculate the means.
 * @returns {Mean[]} One entry per distinct X coordinate, containing x, the mean y, and the number of points n.
 */
function computeMeans(marks) {
  /** @type {Map<number, {sum: number, n: number}>} */
  const acc = new Map();
  for (const m of marks) {
    const a = acc.get(m.point.x) ?? { sum: 0, n: 0 };
    a.sum += m.point.y;
    a.n += 1;
    acc.set(m.point.x, a);
  }
  return [...acc].map(([x, { sum, n }]) => ({ x, y: sum / n, n }));
}
