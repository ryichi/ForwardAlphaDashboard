'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const closure = read('product-closure.js');
const styles = read('styles.css');
const meta = JSON.parse(read('data/site-meta.json'));
const snapshot = JSON.parse(read('data/snapshot_manifest.json'));
const manifest = JSON.parse(read('data/source_manifest.json'));
const records = meta.record_files.flatMap(file => JSON.parse(read(file)));

const scriptOrder = ['contract-bootstrap.js', 'app.js', 'contract-guard.js', 'product-closure.js']
  .map(script => index.indexOf(`src="${script}"`));
assert(scriptOrder.every(index => index >= 0), 'all production scripts must be present');
assert(scriptOrder.every((value, index) => index === 0 || value > scriptOrder[index - 1]), 'authoritative script order changed');
assert(!index.includes('僅 READY 標的具有正式排名'), 'stale READY-only ranking copy remains');
assert(index.includes('value="PARTIAL_READY"'), 'PARTIAL_READY filter is missing');
assert(!index.includes('Momentum、Risk 與估值方法'), 'Compare still promises unpublished Risk capability');
assert(index.includes('90 日風險資料尚未公開'), 'Compare does not disclose unavailable Risk capability');
assert(index.includes('id="capabilityMatrix"'), 'Capability Matrix mount is missing');
assert(index.includes('id="factorGuideTitle"'), 'five-factor explanation is missing');
assert(index.includes('不構成投資建議'), 'factor explanation investment boundary is missing');
for (const label of ['獲利能力', '財務穩健', '前瞻成長', '盈餘修正', '相對估值']) {
  assert(index.includes(`<b>${label}</b>`), `${label} explanation is missing`);
}
assert(!index.includes('原始 ROE') && !index.includes('原始 EBITDA'), 'factor guide claims unpublished raw metrics');

assert(!/decodeSitePayload\s*=/.test(closure), 'UI closure must not replace the authoritative decoder');
assert(!/assignRanks\s*=/.test(closure), 'UI closure must not replace ranking eligibility rules');
assert(!/enrich\s*=/.test(closure), 'UI closure must not replace authoritative model enrichment');
assert(closure.includes('尚未形成正式排名'), 'NOT_DUE ranking exception copy is missing');
assert(closure.includes('本次有效價格期間'), 'PARTIAL_READY valid-horizon copy is missing');
assert(closure.includes('data-capability-status'), 'Capability Matrix status contract is missing');
assert(closure.includes('90 日風險：尚未公開'), 'Risk unavailable state is missing from Compare');
assert(styles.includes('@media(max-width:760px)'), 'small-screen rules are missing');
assert(styles.includes('.ranking-table th:first-child'), 'mobile sticky ranking columns are missing');
assert(styles.includes('.factor-guide-grid'), 'factor explanation layout is missing');

assert.equal(meta.schema_version, 5);
assert.equal(records.length, 937);
assert.equal(records.length, meta.record_count);
assert.equal(records.length, snapshot.universe_count);

const byStatus = Object.groupBy(records, row => row[47]);
assert.equal(byStatus.READY.length, 919);
assert.equal(byStatus.PARTIAL_READY.length, 12);
assert.equal(byStatus.NOT_DUE.length, 6);
assert.equal(snapshot.model_score_eligible, byStatus.READY.length + byStatus.PARTIAL_READY.length);
assert.equal(snapshot.model_unresolved, 0);
assert.equal(snapshot.web_complete, records.length);
assert.equal(snapshot.publish_ready, true);

const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
for (const row of byStatus.PARTIAL_READY) {
  const returns = row.slice(18, 21).filter(finite);
  assert(returns.length === 1 || returns.length === 2, `${row[0]} must have one or two real horizons`);
  assert(row[48], `${row[0]} PARTIAL_READY reason missing`);
  assert(finite(row[11]) && finite(row[12]), `${row[0]} PARTIAL_READY momentum missing`);
  assert(row.slice(29, 34).every(finite), `${row[0]} formal selections missing`);
  assert(finite(row[35]) && finite(row[43]), `${row[0]} consensus selection missing`);
}

for (const row of byStatus.NOT_DUE) {
  assert(row.slice(18, 21).every(value => !finite(value)), `${row[0]} NOT_DUE exposes a return horizon`);
  assert(!finite(row[11]) && !finite(row[12]), `${row[0]} NOT_DUE exposes Momentum`);
  assert(row.slice(29, 34).every(value => !finite(value)), `${row[0]} NOT_DUE exposes formal Selection`);
  assert(!finite(row[35]) && !finite(row[36]), `${row[0]} NOT_DUE exposes formal consensus score`);
  assert(row.slice(37, 42).every(value => !finite(value)), `${row[0]} NOT_DUE exposes comparable Selection`);
  assert(!finite(row[43]) && !finite(row[44]), `${row[0]} NOT_DUE exposes comparable consensus score`);
  assert(row[48], `${row[0]} NOT_DUE reason missing`);
}

const risk = manifest.sources.find(source => source.dataset === 'risk_90d');
assert(risk, 'risk_90d manifest row missing');
assert.equal(risk.freshness_status, 'NOT_EXPOSED');
assert.equal(risk.coverage, 0);

console.log('product closure static/data tests OK');
