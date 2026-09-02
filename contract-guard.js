'use strict';

// Production contract guard for compact payload v3/v4/v5.
// Loaded immediately after app.js. app.js starts async fetches before this script runs,
// so these function bindings are replaced before the awaited payload is decoded.
(() => {
  const legacyDecode = decodeSitePayload;
  const legacyRenderOverview = renderOverview;
  const legacyOpenDetail = openDetail;

  const snapshotUniverse = s => Number(s.universe_count || s.formal_universe || 0);
  const snapshotProvesAllReady = (s, count) =>
    Number(s.model_ready || 0) === count &&
    Number(s.model_not_due || 0) === 0 &&
    Number(s.model_unresolved || 0) === 0 &&
    Number(s.web_complete || 0) === count &&
    Boolean(s.publish_ready);

  function statusReason(r) {
    if (r.quality?.model_status === 'NOT_DUE') return (r.quality.not_due || []).join('; ') || r.quality.reason || '';
    if (r.quality?.model_status === 'UNRESOLVED') return (r.quality.blockers || []).join('; ') || r.quality.reason || '';
    return r.quality?.reason || '';
  }

  function compactRecord(row, schema, dictionaries, counts) {
    const sectors = dictionaries.sectors || [], industries = dictionaries.industries || [];
    const subs = dictionaries.subindustries || [], methods = dictionaries.valuation_methods || [];
    if (!Array.isArray(row) || row.length < (schema === 5 ? 50 : 27)) {
      throw new Error(`Compact V${schema} record 欄位不足`);
    }
    const [ticker, company, sectorI, industryI, subI, pool,
      profitability, financialStrength, forwardGrowth, earningsRevision, valuation,
      momentum, comparableMomentum, compBalanced, compQuality, compGrowth, compEarnings, compGarp,
      ret3, ret6, ret12, currentPe, evEbitda, methodI] = row;

    const statusIndex = schema === 5 ? 47 : 24;
    const reasonIndex = schema === 5 ? 48 : 25;
    const completeIndex = schema === 5 ? 49 : 26;
    const status = String(row[statusIndex] || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(counts, status)) throw new Error(`${ticker}: 無效 model_status=${status}`);
    const reason = String(row[reasonIndex] || '');
    if (status === 'NOT_DUE' && !reason) throw new Error(`${ticker}: NOT_DUE 缺少原因`);
    counts[status] += 1;
    const webComplete = Boolean(row[completeIndex]);
    const returns = [ret3, ret6, ret12], full = returns.every(v => v !== null && v !== '');
    const ready = status === 'READY', notDue = status === 'NOT_DUE';
    const record = {
      ticker, company,
      taxonomy: { sector: sectors[sectorI] || '', industry: industries[industryI] || '', subindustry: subs[subI] || '' },
      factors: {
        profitability: { value: profitability, status: 'READY', reason: '' },
        financial_strength: { value: financialStrength, status: 'READY', reason: '' },
        forward_growth: { value: forwardGrowth, status: 'READY', reason: '' },
        earnings_revision: { value: earningsRevision, status: 'READY', reason: '' },
        valuation: { value: valuation, status: 'READY', reason: '' }
      },
      momentum: {
        ret_3m: ret3, ret_6m: ret6, ret_12m: ret12,
        weights: ready ? { ret_3m: .15, ret_6m: .35, ret_12m: .50 } : {},
        status,
        history_status: ready ? (full ? 'FULL_READY' : 'PARTIAL_READY') : status,
        history_age_days: null,
        partial_real_renormalization: ready && !full,
        reason,
        score_eligible: ready,
        web_valid: status !== 'UNRESOLVED'
      },
      quality: {
        model_ready: ready,
        model_not_due: notDue,
        model_status: status,
        reason,
        not_due: notDue && reason ? [reason] : [],
        blockers: status === 'UNRESOLVED' && reason ? [reason] : [],
        web_complete: webComplete,
        data_imputation_note: schema === 5 ? String(row[46] || '') : ''
      },
      risk: {
        std_dev_90d: null, downside_dev_90d: null, risk_score: null, role: 'REPORT_ONLY', status: 'NOT_EXPOSED',
        source_status: 'NOT_EXPOSED_IN_PRODUCTION_XLSX', source_series: '',
        reason: 'PRODUCTION_XLSX_DOES_NOT_EXPOSE_90D_RISK_VALUES_FOR_THIS_SNAPSHOT'
      },
      valuation: {
        method: methods[methodI] || '', status: 'READY', current_forward_pe: currentPe, ev_ebitda: evEbitda,
        reason: currentPe === null ? 'Current Forward P/E 尚未補齊；不影響正式 Universe' : 'Current Forward P/E 已有資料'
      }
    };
    if (schema === 5) record._comparableNote = String(row[45] || '');

    const official = schema === 5
      ? [
          ticker, pool, momentum, comparableMomentum,
          compBalanced, compQuality, compGrowth, compEarnings, compGarp,
          ...row.slice(24, 29), ...row.slice(29, 34), row[34], row[35], row[36],
          ...row.slice(37, 42), row[42], row[43], row[44]
        ]
      : [ticker, pool, momentum, comparableMomentum, compBalanced, compQuality, compGrowth, compEarnings, compGarp];
    return { record, official, webComplete };
  }

  decodeSitePayload = function(payload, snapshot) {
    if (!payload || payload.dataset !== 'forward_alpha_site_compact' || !Array.isArray(payload.records)) {
      throw new Error('網站 compact payload 格式錯誤');
    }
    const schema = Number(payload.schema_version || 0);
    const count = Number(payload.record_count || 0);
    if (count !== payload.records.length || count !== snapshotUniverse(snapshot)) {
      throw new Error('Compact payload 與 Snapshot Universe 數量不一致');
    }

    // V3 did not carry per-ticker status. It is safe only when the authoritative
    // Snapshot mathematically proves that every record is READY. Any NOT_DUE/UNRESOLVED
    // snapshot must upgrade to V4+ with explicit row status; otherwise fail closed.
    if (schema === 3) {
      if (!snapshotProvesAllReady(snapshot, count)) {
        throw new Error('Compact V3 缺少逐檔 model_status；非全 READY Snapshot 必須使用 V4，已 fail closed');
      }
      const decoded = legacyDecode(payload, snapshot);
      decoded.data.model_ready = Number(snapshot.model_ready || 0);
      decoded.data.model_not_due = Number(snapshot.model_not_due || 0);
      decoded.data.model_resolved = Number(snapshot.model_resolved || count);
      decoded.data.model_unresolved = Number(snapshot.model_unresolved || 0);
      decoded.data.web_complete = Number(snapshot.web_complete || 0);
      decoded.data.publish_ready = Boolean(snapshot.publish_ready);
      decoded.data.records.forEach(r => { r.quality.reason = ''; });
      return decoded;
    }

    if (![4, 5].includes(schema)) throw new Error(`不支援的 compact schema: ${schema}`);

    const d = payload.dictionaries || {};
    const records = [], officialRecords = [];
    const counts = { READY: 0, NOT_DUE: 0, UNRESOLVED: 0 };
    let webComplete = 0;

    for (const row of payload.records) {
      const decoded = compactRecord(row, schema, d, counts);
      records.push(decoded.record);
      officialRecords.push(decoded.official);
      webComplete += decoded.webComplete ? 1 : 0;
    }

    const expected = {
      READY: Number(snapshot.model_ready || 0),
      NOT_DUE: Number(snapshot.model_not_due || 0),
      UNRESOLVED: Number(snapshot.model_unresolved || 0)
    };
    if (counts.READY !== expected.READY || counts.NOT_DUE !== expected.NOT_DUE || counts.UNRESOLVED !== expected.UNRESOLVED) {
      throw new Error(`逐檔 status 與 Snapshot 統計不一致 rows=${JSON.stringify(counts)} snapshot=${JSON.stringify(expected)}`);
    }
    if (webComplete !== Number(snapshot.web_complete || 0)) throw new Error('逐檔 web_complete 與 Snapshot 統計不一致');

    return {
      data: {
        schema_version: schema, dataset: 'universe_web', membership_source: payload.membership_source,
        universe_count: count, formal_universe: count,
        technology_count: payload.technology_count, outside_count: payload.outside_count,
        model_ready: counts.READY, model_not_due: counts.NOT_DUE,
        model_resolved: counts.READY + counts.NOT_DUE, model_unresolved: counts.UNRESOLVED,
        web_complete: webComplete, publish_ready: Boolean(snapshot.publish_ready),
        production_model_changed: false, blockers: [], blocker_summary: {}, records
      },
      official: {
        schema_version: schema, dataset: 'official_model_universe_compact', market_key: snapshot.market_key,
        membership_source: payload.membership_source, record_count: count,
        technology_count: payload.technology_count, outside_count: payload.outside_count,
        model_order: payload.model_order, records: officialRecords
      }
    };
  };

  enrich = function(records, official) {
    if (!official || official.dataset !== 'official_model_universe_compact' || !Array.isArray(official.records) || official.record_count !== official.records.length || official.record_count !== records.length) {
      throw new Error('正式五模型資料與 Active Universe 數量不一致');
    }
    if (official.market_key !== state.snapshot.market_key) throw new Error(`正式五模型 Market Key 不一致：${official.market_key} / ${state.snapshot.market_key}`);
    const order = official.model_order || [], expected = Object.keys(MODELS);
    if (order.join('|') !== expected.join('|')) throw new Error('正式五模型順序不一致');
    const map = new Map(official.records.map(x => [x[0], x]));
    if (map.size !== official.records.length) throw new Error('正式五模型 Ticker 有重複');
    const baseTickers = new Set(records.map(r => r.ticker));
    const missing = records.filter(r => !map.has(r.ticker)).map(r => r.ticker);
    const extra = official.records.filter(x => !baseTickers.has(x[0])).map(x => x[0]);
    if (missing.length || extra.length) throw new Error(`正式五模型 Ticker 集合不一致：missing=${missing.join(',')} extra=${extra.join(',')}`);

    for (const r of records) {
      const row = map.get(r.ticker), pool = row[1];
      if (!['T', 'O'].includes(pool)) throw new Error(`${r.ticker} 正式 Pool 資料缺失`);
      const ready = modelStatus(r) === 'READY';
      const momentum = finite(row[2]) ? Number(row[2]) : NaN;
      const comparableMomentum = finite(row[3]) ? Number(row[3]) : NaN;
      if (ready && (!finite(momentum) || !finite(comparableMomentum))) throw new Error(`${r.ticker} READY 但正式 Momentum 資料缺失`);
      r._officialPool = pool;
      r._momentum = momentum;
      r._comparable = { momentum: comparableMomentum };
      r._models = { formal: {}, comparable: {} };

      if (Number(official.schema_version || 0) >= 5) {
        expected.forEach((m, i) => {
          const compAlpha = finite(row[4 + i]) ? Number(row[4 + i]) : NaN;
          const formalAlpha = finite(row[9 + i]) ? Number(row[9 + i]) : NaN;
          const formalSelection = finite(row[14 + i]) ? Number(row[14 + i]) : NaN;
          const compSelection = finite(row[22 + i]) ? Number(row[22 + i]) : NaN;
          if (ready && (![compAlpha, formalAlpha, formalSelection, compSelection].every(Number.isFinite))) {
            throw new Error(`${r.ticker} READY 但 ${m} Production model values 缺失`);
          }
          r._models.formal[m] = { alpha: formalAlpha, selection: formalSelection };
          r._models.comparable[m] = { alpha: compAlpha, selection: compSelection };
        });
        const formalConsensus = [row[19], row[20], row[21]].map(v => finite(v) ? Number(v) : NaN);
        const comparableConsensus = [row[27], row[28], row[29]].map(v => finite(v) ? Number(v) : NaN);
        if (ready && (![...formalConsensus, ...comparableConsensus].every(Number.isFinite))) {
          throw new Error(`${r.ticker} READY 但 Production consensus values 缺失`);
        }
        r._models.formal.consensus = { alpha: formalConsensus[0], selection: formalConsensus[1], divergence: formalConsensus[2] };
        r._models.comparable.consensus = { alpha: comparableConsensus[0], selection: comparableConsensus[1], divergence: comparableConsensus[2] };
      } else {
        expected.forEach((m, i) => {
          const formalAlpha = alphaFromFactors(r, m), compAlpha = finite(row[4 + i]) ? Number(row[4 + i]) : NaN;
          if (ready && (!finite(formalAlpha) || !finite(compAlpha))) throw new Error(`${r.ticker} READY 但 ${m} 正式 Alpha 缺失`);
          r._models.formal[m] = {
            alpha: formalAlpha,
            selection: ready && finite(formalAlpha) && finite(momentum) ? .7 * Number(formalAlpha) + .3 * Number(momentum) : NaN
          };
          r._models.comparable[m] = {
            alpha: compAlpha,
            selection: ready && finite(compAlpha) && finite(comparableMomentum) ? .7 * Number(compAlpha) + .3 * Number(comparableMomentum) : NaN
          };
        });
        r._models.formal.consensus = consensusFrom(r._models.formal);
        r._models.comparable.consensus = consensusFrom(r._models.comparable);
      }
    }
    const tech = records.filter(isTechnology).length, outside = records.length - tech;
    if (tech !== official.technology_count || outside !== official.outside_count) throw new Error(`正式分析池數量不一致：Technology ${tech}, Outside ${outside}`);
    assignRanks(records, 'formal');
    assignRanks(records, 'comparable');
  };

  assignRanks = function(records, scale) {
    for (const r of records) for (const m of [...Object.keys(MODELS), 'consensus']) delete r._models?.[scale]?.[m]?.rank;
    for (const m of [...Object.keys(MODELS), 'consensus']) {
      const arr = records
        .filter(r => modelStatus(r) === 'READY' && finite(r._models?.[scale]?.[m]?.selection))
        .sort((a, b) => b._models[scale][m].selection - a._models[scale][m].selection);
      arr.forEach((r, i) => { r._models[scale][m].rank = i + 1; });
    }
  };

  renderOverview = function() {
    legacyRenderOverview();
    const s = state.snapshot;
    const strategy = s.model_strategy || s.model_policy || '—';
    const report = s.report_schema || '—';
    $('#snapshotMeta').innerHTML = `Market Key <b>${esc(s.market_key)}</b><br>Snapshot R${s.snapshot_revision} · Strategy ${esc(strategy)}<br>Report ${esc(report)}`;
  };

  openDetail = function(ticker) {
    legacyOpenDetail(ticker);
    const r = state.records.find(x => x.ticker === ticker);
    const reason = r ? statusReason(r) : '';
    if (reason) {
      $('#detailContent').insertAdjacentHTML('afterbegin', `<div class="note-box"><b>${esc(modelStatus(r))}</b>：${esc(reason)}</div>`);
    }
  };

  exportCSV = function() {
    const arr = rankingData();
    const header = [
      'Rank','Ticker','Company','Industry','Alpha','Momentum','Selection','Model Divergence','Status','Status Reason',
      'Market Key','Snapshot ID','Model Strategy','Report Schema','Scale','Model'
    ];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const strategy = state.snapshot.model_strategy || state.snapshot.model_policy || '';
    const report = state.snapshot.report_schema || '';
    const lines = [header.map(q).join(',')];
    arr.forEach(x => lines.push([
      x.rank === 999 ? '' : x.rank, x.ticker, x.company, x.industry, x.alpha, x.momentum, x.selection, x.divergence,
      x.status, statusReason(x.r), state.snapshot.market_key, state.snapshot.snapshot_id || '', strategy, report,
      state.rank.scale, state.rank.model
    ].map(q).join(',')));
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ForwardAlpha_Rankings_${state.snapshot.market_key}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
})();
