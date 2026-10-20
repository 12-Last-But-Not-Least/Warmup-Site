import Papa from './vendor/papa.js';
import { buildFromParsed } from './data.js';
import { createModel, generatedPair, LIMITS } from './model.js';

let model, cancelledExports = new Set();
function parseFile(file, id, index, budget) {
  if (file.size > LIMITS.fileBytes) throw new Error(`${file.name}: exceeds the 5 MiB per-file limit. Choose a smaller file.`);
  return new Promise((resolve, reject) => {
    let record = 0, columns, failed = false;
    const rows = [], recordNumbers = [], warnings = [];
    const warn = text => { if (warnings.length < 200) warnings.push(text); };
    Papa.parse(file, { delimiter: ',', chunkSize: 256 * 1024, step(result, parser) {
      try {
        record++;
        const fields = result.data;
        if (record === 1) {
          columns = fields.map(v => v.trim());
          if (result.errors.length || columns.length < 2 || columns.some(v => !v) || new Set(columns).size !== columns.length) throw new Error(`${file.name}: use a nonempty, unique header with at least one value column.`);
          if (columns.length - 1 > LIMITS.columns) throw new Error(`${file.name}: more than ${LIMITS.columns} value columns. Select fewer columns before importing.`);
          return;
        }
        if (record > LIMITS.rows + 1) throw new Error(`${file.name}: exceeds ${LIMITS.rows.toLocaleString()} CSV records.`);
        budget.cells += Math.max(0, fields.length - 1);
        if (budget.cells > LIMITS.cells) throw new Error('The two files exceed the combined 250,000-cell limit. Import a smaller subset. No data was silently truncated.');
        if (result.errors.length) { warn(`CSV record ${record} skipped: ${result.errors[0].message}`); return; }
        if (fields.every(v => !v.trim())) return;
        if (fields.length !== columns.length) { warn(`CSV record ${record} skipped: wrong number of fields`); return; }
        rows.push(fields); recordNumbers.push(record);
        if (record % 1000 === 0) self.postMessage({ id, progress: `Reading file ${index + 1} of 2 · ${record.toLocaleString()} records` });
      } catch (error) { failed = true; parser.abort(); reject(error); }
    }, complete() {
      if (failed) return;
      try {
        if (!columns) throw new Error(`${file.name}: the file is empty.`);
        const result = buildFromParsed({ columns, rows, rowNumbers: recordNumbers, warnings });
        const warningCount = result.warnings.length;
        result.warnings = result.warnings.slice(0, 200);
        if (warningCount > 200) result.warnings.push(`${warningCount - 200} additional warnings omitted from the preview.`);
        if (!result.series.length) throw new Error(`${file.name}: no usable numeric observations. Check group names and values.`);
        resolve(result);
      } catch (e) { reject(e); }
    }, error: reject });
  });
}
self.onmessage = async ({ data: { id, type, payload = {} } }) => {
  if (type === 'cancel-export') { cancelledExports.add(payload.id); return; }
  try {
    let result;
    if (type === 'load') {
      const budget = { cells: 0 };
      let files = payload.files;
      if (payload.generated) files = generatedPair(payload.generated, payload.edge).map((text, i) => new File([text], `${payload.generated}-groups-${i ? 'sleep' : 'steps'}.csv`, { type: 'text/csv' }));
      const parsed = [];
      for (let i = 0; i < 2; i++) parsed.push(await parseFile(files[i], id, i, budget));
      self.postMessage({ id, progress: 'Matching groups and categories · calculating summaries…' });
      model = createModel(...parsed, files.map(f => f.name));
      result = model.view();
    } else {
      if (!model) throw new Error('Load a dataset first.');
      if (type === 'view') result = model.view(payload);
      else if (type === 'page') result = model.page(payload);
      else if (type === 'export') {
        const { columns, rows } = model.table(payload);
        const parts = ['\uFEFF', Papa.unparse([columns], { escapeFormulae: true }) + '\r\n'];
        for (let start = 0; start < rows.length; start += 1000) {
          if (cancelledExports.delete(id)) throw new Error('Export cancelled.');
          parts.push(Papa.unparse(rows.slice(start, start + 1000), { escapeFormulae: true }) + '\r\n');
          self.postMessage({ id, progress: `Preparing CSV · ${Math.min(start + 1000, rows.length).toLocaleString()} / ${rows.length.toLocaleString()} rows` });
          await new Promise(r => setTimeout(r, 0));
        }
        if (cancelledExports.delete(id)) throw new Error('Export cancelled.');
        result = { blob: new Blob(parts, { type: 'text/csv;charset=utf-8' }), rows: rows.length };
      } else throw new Error('Unknown request.');
    }
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message ?? String(error) }); }
};
