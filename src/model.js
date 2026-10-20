import { nameKey } from './data.js';
import { describe, linearFit, pearson } from './stats.js';

export const LIMITS = { fileBytes: 5 * 1024 * 1024, cells: 250000, rows: 20000, columns: 512, drawn: 3000, individualGroups: 20 };
export function sample(points, cap = LIMITS.drawn) {
  if (points.length <= cap) return points;
  return Array.from({ length: cap }, (_, i) => points[Math.floor(i * (points.length - 1) / (cap - 1))]);
}
export function extent(points, axis) {
  let min = Infinity, max = -Infinity, positiveMin = Infinity, positiveMax = -Infinity;
  for (const p of points) {
    const v = p[axis]; min = Math.min(min, v); max = Math.max(max, v);
    if (v > 0) { positiveMin = Math.min(positiveMin, v); positiveMax = Math.max(positiveMax, v); }
  }
  return { linear: min === Infinity ? [] : [min, max], log: positiveMin === Infinity ? [] : [positiveMin, positiveMax] };
}
function chartPayload(points, extra) {
  let xNonPositive = 0, yNonPositive = 0, eitherNonPositive = 0;
  for (const p of points) { if (p.x <= 0) xNonPositive++; if (p.y <= 0) yNonPositive++; if (p.x <= 0 || p.y <= 0) eitherNonPositive++; }
  return { ...extra, points: sample(points), total: points.length, xRanges: extent(points, 'x'), yRanges: extent(points, 'y'), xNonPositive, yNonPositive, eitherNonPositive };
}
function summaries(records, by) {
  const buckets = new Map();
  for (const r of records) {
    const key = by === 'group' ? r.group : r.category;
    if (!buckets.has(key)) buckets.set(key, { order: r.order, values: [] });
    const bucket = buckets.get(key);
    bucket.order = Math.min(bucket.order, r.order);
    bucket.values.push(r.y);
  }
  return [...buckets].map(([label, { order, values }]) => ({ label, order, ...describe(values) }));
}

// Summary sort keys map to describe() fields; NaN (e.g. SD with one value) sorts last.
const SUMMARY_FIELDS = { value: 'mean', median: 'median', sd: 'sd', min: 'min', max: 'max' };
const byNumber = (a, b) => (Number.isNaN(a) - Number.isNaN(b)) || a - b;

// Decimal places a file's values are written with, capped at 3, so a table column can show
// every value with the same number of decimals (e.g. integer steps, 3-decimal sleep hours).
const MAX_DECIMALS = 3;
function precisionOf(values) {
  let best = 0;
  for (const v of values) {
    const text = String(v);
    const decimals = text.includes('e') ? MAX_DECIMALS : text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
    if (decimals > best && (best = Math.min(MAX_DECIMALS, decimals)) === MAX_DECIMALS) break;
  }
  return best;
}
/** Short, stable id of the cleaned data (FNV-1a), so two versions of the same pair export under different names. */
function fingerprintOf(recordLists) {
  let hash = 0x811c9dc5;
  for (const records of recordLists) {
    for (const r of records) {
      const text = `${r.group}\u0001${r.category}\u0001${r.y}\n`;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
    hash = Math.imul(hash ^ 0x1e, 0x01000193); // file separator
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

export function createModel(a, b, names = ['First CSV', 'Second CSV']) {
  const canonical = new Map();
  for (const d of [a, b]) for (const s of d.series) if (!canonical.has(nameKey(s.group))) canonical.set(nameKey(s.group), s.group);
  const groups = [...canonical.values()].sort((x, y) => x.localeCompare(y));
  const groupSlots = Object.fromEntries(groups.map((g, i) => [g, i]));
  const flatten = d => d.series.flatMap(s => s.points.map(([x, y]) => ({ group: canonical.get(nameKey(s.group)), category: d.xTickLabels?.[x] ?? String(x), order: x, x, y })));
  const original = [flatten(a), flatten(b)];
  const bIndex = new Map(original[1].map(r => [JSON.stringify([nameKey(r.group), r.category]), r.y]));
  const paired = original[0].flatMap(r => {
    const x = bIndex.get(JSON.stringify([nameKey(r.group), r.category]));
    // `x` holds the second file's value here, so the category position travels separately as `order`.
    return x === undefined ? [] : [{ group: r.group, category: r.category, order: r.order, x, y: r.y }];
  });
  const labels = [a.valueHeader || names[0], b.valueHeader || names[1]];
  const fingerprint = fingerprintOf(original);
  const precision = original.map(rs => precisionOf(rs.map(r => r.y)));
  // Means, medians and SDs get one digit more than the raw values, within the cap.
  const statDecimals = precision.map(p => Math.min(MAX_DECIMALS, p + 1));
  let filterKey = null, filtered, tables = new Map();
  function filter(query = '') {
    const key = nameKey(query);
    if (filterKey === key) return;
    filterKey = key; tables = new Map();
    const keep = r => nameKey(r.group).includes(key);
    filtered = [...original.map(rs => rs.filter(keep)), paired.filter(keep)];
  }
  function view({ query = '', overview = 'auto', hiddenBySource = [] } = {}) {
    filter(query);
    const visible = filtered.map((rows, i) => {
      const excluded = new Set(hiddenBySource[i] ?? []);
      return rows.filter(r => !excluded.has(r.group));
    });
    const [ra, rb, rp] = visible;
    const selectedGroups = new Set([...ra, ...rb].map(r => r.group)).size;
    const aggregate = overview === 'overview' || selectedGroups > LIMITS.individualGroups;
    const fit = { n: rp.length, r: pearson(rp), ...linearFit(rp) };
    const line = (records, i, ticks) => {
      const useMeans = overview === 'overview' || new Set(records.map(r => r.group)).size > LIMITS.individualGroups;
      const buckets = new Map();
      for (const r of records) { if (!buckets.has(r.x)) buckets.set(r.x, { sum: 0, n: 0, category: r.category }); const v = buckets.get(r.x); v.sum += r.y; v.n++; }
      const meanPoints = [...buckets].map(([x, v]) => ({ x, y: v.sum / v.n, n: v.n, group: 'Category mean', category: v.category }));
      const points = useMeans ? meanPoints : records;
      return chartPayload(points, { title: labels[i], xLabel: '', yLabel: labels[i], xTickLabels: ticks, connectGroups: true, aggregate: useMeans, meanPoints, sourceTotal: records.length, groupSlots });
    };
    const chartInputs = [line(ra, 0, a.xTickLabels), line(rb, 1, b.xTickLabels), chartPayload(rp, { title: `${labels[0]} vs. ${labels[1]}`, xLabel: labels[1], yLabel: labels[0], showTrend: true, statsOverride: rp.length > LIMITS.drawn ? fit : undefined, groupSlots })];
    chartInputs.forEach((chart, i) => {
      chart.groupNames = [...new Set(filtered[i].map(r => r.group))].sort((x, y) => x.localeCompare(y));
      chart.hiddenGroups = [...(hiddenBySource[i] ?? [])];
      chart.hiddenObservations = filtered[i].length - visible[i].length;
    });
    return {
      names, labels, groups: selectedGroups, aggregate, counts: visible.map(r => r.length), unfilteredCounts: [...original.map(r => r.length), paired.length],
      stats: [describe(ra.map(r => r.y)), describe(rb.map(r => r.y))], fit, precision, statDecimals, fingerprint,
      charts: chartInputs,
      warnings: [...a.warnings.map(w => `${names[0]}: ${w}`), ...b.warnings.map(w => `${names[1]}: ${w}`)].slice(0, 60),
    };
  }
  function table({ source = 0, mode = 'detail', sortBy = 'group', direction = 'asc', query = '', excludedGroups = [] } = {}) {
    filter(query);
    const excluded = new Set(excludedGroups);
    const dir = direction === 'desc' ? -1 : 1;
    const cacheKey = JSON.stringify([source, mode, sortBy, dir, [...excluded].sort()]);
    if (!tables.has(cacheKey)) {
      const pairedSource = source === 2;
      const records = (filtered[source] ?? []).filter(r => !excluded.has(r.group));
      const columns = mode === 'detail' ? ['Group', 'Category', ...(pairedSource ? [labels[1], labels[0]] : [labels[source]])] : [mode === 'group' ? 'Group' : 'Category', 'n', 'Mean', 'Median', 'Sample SD', 'Min', 'Max'];
      let rows;
      if (mode === 'detail') {
        // 'value' is the first file's value (y); 'second' is the second file's value (x), which only
        // matched pairs have. Summary-only keys (median, sd, ...) have no per-row meaning, so they sort by value.
        const key = sortBy === 'group' ? (a, b) => a.group.localeCompare(b.group)
          : sortBy === 'category' ? (a, b) => a.category.localeCompare(b.category)
          : sortBy === 'second' && pairedSource ? (a, b) => a.x - b.x
          : (a, b) => a.y - b.y;
        const sorted = [...records].sort((a, b) => dir * key(a, b) || a.group.localeCompare(b.group) || a.order - b.order);
        rows = sorted.map(r => [r.group, r.category, ...(pairedSource ? [r.x, r.y] : [r.y])]);
      } else {
        const field = SUMMARY_FIELDS[sortBy];
        // "Group / original category order" keeps categories in file order; "Category name" is alphabetical.
        const key = field ? (a, b) => byNumber(a[field], b[field])
          : mode === 'category' && sortBy !== 'category' ? (a, b) => a.order - b.order
          : (a, b) => a.label.localeCompare(b.label);
        const values = summaries(records, mode).sort((a, b) => dir * key(a, b) || a.label.localeCompare(b.label));
        rows = values.map(s => [s.label, s.n, s.mean, s.median, s.sd, s.min, s.max]);
      }
      // Paired summaries describe the first file (Y), so they use its precision.
      const valueFile = pairedSource ? 0 : source;
      const decimals = mode === 'detail'
        ? [null, null, ...(pairedSource ? [precision[1], precision[0]] : [precision[source]])]
        : [null, 0, statDecimals[valueFile], statDecimals[valueFile], statDecimals[valueFile], precision[valueFile], precision[valueFile]];
      tables.set(cacheKey, { columns, rows, decimals, note: pairedSource && mode !== 'detail' ? `Summaries describe ${labels[0]} (Y) within matched pairs.` : '' });
      if (tables.size > 8) tables.delete(tables.keys().next().value);
    }
    return tables.get(cacheKey);
  }
  return { view, table, page(options = {}) {
    const t = table(options), size = [25, 50, 100].includes(Number(options.size)) ? Number(options.size) : 50;
    const pages = Math.max(1, Math.ceil(t.rows.length / size));
    const page = Math.max(0, Math.min(Number(options.page) || 0, pages - 1));
    return { ...t, rows: t.rows.slice(page * size, (page + 1) * size), total: t.rows.length, page, pages, size };
  } };
}

export function generatedPair(count, edge = false) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const a = [`Daily steps,${days.join(',')}`], b = [`Sleep (hours),${days.join(',')}`];
  for (let i = 0; i < count; i++) {
    const person = `Person ${String(i + 1).padStart(5, '0')}`;
    const steps = days.map((_, d) => edge && d === 0 ? 0 : Math.round(5200 + 2500 * Math.sin(i * 1.37 + d) + (i % 17) * 130));
    const sleep = steps.map((s, d) => edge && d === 1 ? -1 : Number((8.6 - s / 5200 + Math.sin(i * 0.71 + d) * 0.8).toFixed(3)));
    a.push([person, ...steps].join(',')); b.push([person.toLowerCase(), ...sleep].join(','));
  }
  return [a.join('\n'), b.join('\n')];
}
