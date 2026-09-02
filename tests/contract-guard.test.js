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
  row[11] = row[12] = 60;
  row[13] = row[14] = row[15] = row[16] = row[17] = 50;
  row[24] = status;
  row[25] = reason;
  row[26] = webComplete;
  return row;
}

const allReadySnapshot = {
  universe_count: 2, model_ready: 2, model_not_due: 0, model_unresolved: 0,
  model_resolved: 2, web_complete: 2, publish_ready: true, market_key: '2026-09-01'
};
const v3 = {
  schema_version: 3, dataset: 'forward_alpha_site_compact', record_count: 2,
  records: [baseRow('AAA').slice(0, 24), baseRow('BBB').slice(0, 24)]
};
assert.equal(ctx.decodeSitePayload(v3, allReadySnapshot).data.model_ready, 2);
assert.throws(
  () => ctx.decodeSitePayload(v3, { ...allReadySnapshot, model_ready: 1, model_not_due: 1 }),
  /fail closed/
);

const mixedSnapshot = { ...allReadySnapshot, model_ready: 1, model_not_due: 1 };
const v4 = {
  schema_version: 4,
  dataset: 'forward_alpha_site_compact',
  record_count: 2,
  dictionaries: { sectors: [], industries: [], subindustries: [], valuation_methods: [] },
  technology_count: 1,
  outside_count: 1,
  model_order: ['balanced'],
  records: [baseRow('AAA'), baseRow('BBB', 'NOT_DUE', 'NEW_LISTING_WAIT_FOR_6M_HISTORY')]
};
const decoded = ctx.decodeSitePayload(v4, mixedSnapshot);
assert.equal(decoded.data.records[1].quality.model_status, 'NOT_DUE');
assert.equal(decoded.data.records[1].quality.model_ready, false);
ctx.state.snapshot = mixedSnapshot;
ctx.enrich(decoded.data.records, decoded.official);
assert(Number.isFinite(decoded.data.records[0]._models.formal.balanced.selection));
assert(Number.isNaN(decoded.data.records[1]._models.formal.balanced.selection));
assert.equal(decoded.data.records[0]._models.formal.balanced.rank, 1);
assert.equal(decoded.data.records[1]._models.formal.balanced.rank, undefined);

console.log('contract guard tests OK');
