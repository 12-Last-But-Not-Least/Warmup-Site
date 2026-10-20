/** Export file naming, kept free of parser/model imports so the page can use it without loading them. */

// Lowercase ASCII with hyphens (accents stripped), max 24 characters; 'data' when nothing is left.
const slug = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'data';

/**
 * `<A>_vs_<B>__<view>__<rows>r__<id>.csv`, e.g. step-count_vs_hours-of-sleep__pairs-obs__35r__a3f9c1.csv.
 * The view code is the source (f1 / f2 / pairs) and display (obs / bycat / bygrp), plus `-flt` when a
 * group filter or hidden legend groups narrow the export.
 */
export function exportFileName({ labels, fingerprint }, { source = 0, mode = 'detail', query = '', excludedGroups = [] }, rows) {
  const view = `${['f1', 'f2', 'pairs'][source]}-${{ detail: 'obs', category: 'bycat', group: 'bygrp' }[mode] ?? mode}`
    + (query.trim() || excludedGroups.length ? '-flt' : '');
  return `${slug(labels[0])}_vs_${slug(labels[1])}__${view}__${rows}r__${fingerprint}.csv`;
}
