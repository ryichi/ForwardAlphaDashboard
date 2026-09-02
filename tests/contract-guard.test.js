const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync('contract-guard.js', 'utf8');
const ctx = {
  console, Number, Boolean, Object, Array, Map, Set, JSON, Math, NaN,
  Blob: function () {},
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  document: { createElement: () => ({ click() {} }) },
  setTimeout: () => {},
  state: { snapshot: { market_key: '2026-09-01' }, records: [], rank: { scale: 'formal', model: 'consensus' } },
  MODELS: { balanced: { w: { profitability: 1 } } },
  finite: v => v !== null && v !== '' && Number.isFinite(Number(v)),
  factor: (r, k) => r.factors?.[k]?.value,
  alphaFromFactors: r => Number(r.factors.profitability.value),
  consensusFrom: models => {
    const alpha = Object.values(models).filter(x => x && x.alpha !== undefined).map(x => x.alpha).filter(Number.isFinite);
    const selection = Object.values(models).filter(x => x && x.selection !== undefined).map(x => x.selection).filter(Number.isFinite);
    return { alpha: alpha[0] ?? NaN, selection: selection[0] ?? NaN, divergence: selection.length ? 0 : NaN };
  },
  modelStatus: r => r.quality?.model_status || 'UNRESOLVED',
  isTechnology: r => r._officialPool === 'T',
  esc: x => String(x),
  $: () => ({ innerHTML: '', insertAdjacentHTML() {} }),
  metric: () => '',
  pillStatus: () => '',
  renderOverview: function () {},
  openDetail: function () {},
  decodeSitePayload: function (payload) {
    return {
      data: {
        records: payload.records.map(row => ({
          ticker: row[0], company: '', taxonomy: {},
          factors: { profitability: { value: 1 } },
          quality: { model_status: 'READY' }, valuation: {}
        })),
        blockers: []
      },
      official: { records: [], model_order: ['balanced'] }
    };
  },
  enrich: function () {},
  assignRanks: function () {},
  rankingData: () => []
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

function baseRow(ticker, status = 'READY', reason = '', webComplete = true) {
  const row = Array(27).fill(null);
  row[0] = ticker;
  row[1] = ticker + ' co';
  row[5] = ticker === 'AAA' ? 'T' : 'O';
  row[6] = row[7] = row[8] = row[9] = row[10] = 50;
  if (status === 'READY' || status === 'PARTIAL_READY') {
    row[11] = row[12] = 60;
    row[13] = row[14] = row[15] = row[16] = row[17] = 50;
    row[18] = 1;
    if (status === 'READY') { row[19] = 2; row[20] = 3; }
  }
  row[24] = status;
  row[25] = reason;
  row[26] = webComplete;
  return row;
}

function v5Row(ticker, status = 'READY', reason = '', webComplete = true) {
  const row = Array(50).fill(null);
  row[0] = ticker;
  row[1] = ticker + ' co';
  row[5] = ticker === 'AAA' ? 'T' : 'O';
  row[6] = 999;
  row[7] = row[8] = row[9] = row[10] = 50;
  const eligible = status === 'READY' || status === 'PARTIAL_READY';
  if (eligible) {
    row[11] = 20;
    row[12] = 30;
    row[13] = 40;
    row[24] = 10;
    row[29] = 11;
    row[34] = 10;
    row[35] = 11;
    row[36] = 0;
    row[37] = 41;
    row[42] = 40;
    row[43] = 41;
    row[44] = 0;
    row[18] = 1;
    row[19] = 2;
    if (status === 'READY') row[20] = 3;
  }
  row[45] = 'GLOBAL_60_SECTOR_40';
  row[46] = 'REAL_ONLY';
  row[47] = status;
  row[48] = reason;
  row[49] = webComplete;
  return row;
}

const allReadySnapshot = {
  universe_count: 2, model_ready: 2, model_partial_ready: 0, model_not_due: 0, model_unresolved: 0,
  model_resolved: 2, model_score_eligible: 2, web_complete: 2, publish_ready: true, market_key: '2026-09-01'
};
const v3 = {
  schema_version: 3, dataset: 'forward_alpha_site_compact', record_count: 2,
  records: [baseRow('AAA').slice(0, 24), baseRow('BBB').slice(0, 24)]
};
assert.equal(ctx.decodeSitePayload(v3, allReadySnapshot).data.model_ready, 2);
assert.throws(
  () => ctx.decodeSitePayload(v3, { ...allReadySnapshot, model_ready: 1, model_partial_ready: 1 }),
  /fail closed/
);

const mixedSnapshot = { ...allReadySnapshot, model_ready: 1, model_not_due: 1, model_score_eligible: 1 };
const v4 = {
  schema_version: 4,
  dataset: 'forward_alpha_site_compact',
  record_count: 2,
  dictionaries: { sectors: [], industries: [], subindustries: [], valuation_methods: [] },
  technology_count: 1,
  outside_count: 1,
  model_order: ['balanced'],
  records: [baseRow('AAA'), baseRow('BBB', 'NOT_DUE', '3M_NOT_DUE')]
};
const decoded = ctx.decodeSitePayload(v4, mixedSnapshot);
ctx.state.snapshot = mixedSnapshot;
ctx.enrich(decoded.data.records, decoded.official);
assert(Number.isFinite(decoded.data.records[0]._models.formal.balanced.selection));
assert(Number.isNaN(decoded.data.records[1]._models.formal.balanced.selection));
assert.equal(decoded.data.records[0]._models.formal.balanced.rank, 1);
assert.equal(decoded.data.records[1]._models.formal.balanced.rank, undefined);

const partialSnapshot = { ...allReadySnapshot, model_ready: 0, model_partial_ready: 1, model_not_due: 1, model_score_eligible: 1 };
const v5 = {
  schema_version: 5,
  dataset: 'forward_alpha_site_compact',
  record_count: 2,
  dictionaries: { sectors: [], industries: [], subindustries: [], valuation_methods: [] },
  technology_count: 1,
  outside_count: 1,
  model_order: ['balanced'],
  records: [v5Row('AAA', 'PARTIAL_READY', 'NEW_LISTING; NOT_DUE=12M'), v5Row('BBB', 'NOT_DUE', '3M_NOT_DUE')]
};
const decoded5 = ctx.decodeSitePayload(v5, partialSnapshot);
ctx.state.snapshot = partialSnapshot;
ctx.enrich(decoded5.data.records, decoded5.official);
const partial = decoded5.data.records[0];
const notDue = decoded5.data.records[1];
assert.equal(partial.quality.model_partial_ready, true);
assert.equal(partial.momentum.score_eligible, true);
assert.equal(partial.momentum.partial_real_renormalization, true);
assert(Math.abs(partial.momentum.weights.ret_3m - .3) < 1e-12);
assert(Math.abs(partial.momentum.weights.ret_6m - .7) < 1e-12);
assert.equal(partial._models.formal.balanced.selection, 11);
assert.equal(partial._models.formal.balanced.rank, 1);
assert(Number.isNaN(notDue._models.formal.balanced.selection));
assert.equal(notDue._models.formal.balanced.rank, undefined);
assert(/warn/.test(ctx.pillStatus('PARTIAL_READY')));
assert.throws(
  () => ctx.decodeSitePayload({ ...v5, records: [v5Row('AAA', 'PARTIAL_READY', ''), v5Row('BBB', 'NOT_DUE', '3M_NOT_DUE')] }, partialSnapshot),
  /PARTIAL_READY 缺少原因/
);

console.log('contract guard tests OK');
