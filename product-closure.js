'use strict';

// Product/UI closure only. The authoritative readiness decoder remains in
// contract-guard.js and is deliberately not reimplemented here.
(() => {
  const guardedRenderOverview = renderOverview;
  const legacyFillControls = fillControls;
  const legacyBind = bind;
  const SCORE_ELIGIBLE = new Set(['READY', 'PARTIAL_READY']);
  const STATUS_LABELS = {
    READY: '完整可評分',
    PARTIAL_READY: '部分歷史可評分',
    NOT_DUE: '尚未到期',
    UNRESOLVED: '資料未解決'
  };
  const CAPABILITY_LABELS = {
    AVAILABLE: '可使用',
    PARTIAL: '部分可用',
    REPORT_ONLY: '僅供資料說明',
    NOT_EXPOSED: '尚未公開',
    FUTURE: '尚未提供'
  };
  const SORT_LABELS = {
    rank: '排名', ticker: '股票代號', company: '公司', industry: '產業',
    alpha: '財務評分', momentum: '價格動能', selection: '綜合評分', divergence: '模型分歧'
  };
  const FRESHNESS_LABELS = {
    VALID: '有效', PARTIAL_VALID: '部分有效', NOT_EXPOSED: '尚未公開'
  };
  const DATASET_NOTES = {
    universe_web: '正式研究範圍；個別資料缺口不會改變成分。',
    price_momentum: '部分歷史標的只用真實可用期間；尚未到期者不產生綜合評分。',
    current_forward_pe: '部分公司沒有本益比；不影響其研究範圍資格。',
    comparison_metrics: '估值因子可用；部分明細倍數尚未公開。',
    earnings_revision: '正式因子可用；原始盈餘修正資料仍有少量缺口。',
    risk_90d: '目前正式快照未公開 90 日風險數值。'
  };

  Object.assign(DATASET_LABEL, {
    universe_web: '正式研究範圍',
    price_momentum: '價格動能',
    risk_90d: '90 日風險',
    comparison_metrics: '相對估值資料',
    earnings_revision: '盈餘修正',
    current_forward_pe: '預估本益比'
  });

  const isScoreEligible = record => SCORE_ELIGIBLE.has(modelStatus(record));
  const statusLabel = status => STATUS_LABELS[status] || '狀態未知';
  const statusClass = status => status === 'READY' ? 'ok' : ['PARTIAL_READY', 'NOT_DUE'].includes(status) ? 'warn' : 'bad';

  function humanStatusReason(record) {
    const raw = String(record?.quality?.reason || record?.momentum?.reason || '');
    if (!raw) return '';
    const firstTrade = raw.match(/FIRST_TRADE_DATE=([0-9-]+)/);
    const notDue = raw.match(/NOT_DUE=([0-9M,]+)/);
    if (raw.includes('3M_NOT_DUE')) {
      return `${firstTrade ? `首次交易日 ${firstTrade[1]}；` : ''}3 個月價格歷史尚未到期`;
    }
    if (raw.includes('NEW_LISTING')) {
      const months = notDue ? notDue[1].replace(/M/g, ' 個月').replace(/,/g, '、') : '';
      return `新上市${months ? `；${months}價格歷史尚未累積完成` : ''}`;
    }
    return raw
      .replaceAll('NEW_LISTING', '新上市')
      .replaceAll('NOT_DUE', '尚未到期')
      .replaceAll('FIRST_TRADE_DATE', '首次交易日');
  }

  function availableHorizons(record) {
    return [
      ['3 個月', record?.momentum?.ret_3m],
      ['6 個月', record?.momentum?.ret_6m],
      ['12 個月', record?.momentum?.ret_12m]
    ].filter(([, value]) => finite(value)).map(([label]) => label);
  }

  function scoreHtml(record, value) {
    return isScoreEligible(record) && finite(value)
      ? n(value)
      : '<span class="score-unavailable">尚未評分</span>';
  }

  function valueHtml(value, formatter = n, missing = '—') {
    return finite(value) ? formatter(value) : `<span class="score-unavailable">${missing}</span>`;
  }

  pillStatus = function(status) {
    return `<span class="pill ${statusClass(status)}" data-status="${esc(status)}" title="${esc(status)}">${esc(statusLabel(status))}</span>`;
  };

  renderLeaderList = function(selector, records, model = 'consensus', scale = 'formal', limit = 10) {
    const ranked = records
      .filter(record => isScoreEligible(record) && finite(record._models?.[scale]?.[model]?.selection))
      .sort((a, b) => a._models[scale][model].rank - b._models[scale][model].rank)
      .slice(0, limit);
    $(selector).innerHTML = ranked.map(record => `
      <div class="leader-row" data-ticker="${esc(record.ticker)}">
        <span class="ranknum">${record._models[scale][model].rank}</span>
        <div><span class="ticker-link">${esc(record.ticker)}</span><span class="subtext">${esc(record.company)} · ${esc(industry(record))}</span></div>
        <div><span class="mini-label">財務評分</span><span class="score">${n(record._models[scale][model].alpha)}</span></div>
        <div><span class="mini-label">價格動能</span><span class="score">${n(scale === 'formal' ? record._momentum : record._comparable.momentum)}</span></div>
        <div><span class="mini-label">綜合評分</span><span class="score orange">${n(record._models[scale][model].selection)}</span></div>
      </div>`).join('');
  };

  fillControls = function() {
    legacyFillControls();
    const firstIndustry = $('#rankIndustry option');
    if (firstIndustry) firstIndustry.textContent = '全部產業';
    $('#modelLabSelect')?.setAttribute('aria-label', '模型領先標的');
  };

  renderOverview = function() {
    guardedRenderOverview();
    const snapshot = state.snapshot;
    const records = state.records;
    const eligible = Number(snapshot.model_score_eligible ?? records.filter(isScoreEligible).length);
    $('#snapshotMeta').innerHTML = `資料日期 <b>${esc(snapshot.market_key)}</b><br>正式快照第 ${esc(snapshot.snapshot_revision)} 版`;
    $('#overviewMetrics').innerHTML = [
      metric('正式研究範圍', `${records.length}`, '全部可搜尋與查看'),
      metric('可取得正式排名', `${eligible}`, '完整與部分歷史標的'),
      metric('完整可評分', `${Number(snapshot.model_ready || 0)}`, '3、6、12 個月歷史完整'),
      metric('部分歷史可評分', `${Number(snapshot.model_partial_ready || 0)}`, '只使用真實可用期間'),
      metric('尚未到期', `${Number(snapshot.model_not_due || 0)}`, '不顯示正式綜合評分'),
      metric('網頁資料完整', `${Number(snapshot.web_complete || 0)}/${records.length}`, `${Number(snapshot.model_unresolved || 0)} 筆異常`)
    ].join('');
    $('#freshnessGrid').innerHTML = state.manifest.sources.map(source => `
      <div class="fresh-card">
        <b>${esc(DATASET_LABEL[source.dataset] || source.dataset)}</b>
        <div><span>資料日期</span><strong>${esc(source.as_of || '—')}</strong></div>
        <div><span>覆蓋率</span><strong>${finite(source.coverage) ? Math.round(source.coverage * 100) + '%' : '—'}</strong></div>
        <div><span>更新狀態</span><strong>${esc(FRESHNESS_LABELS[source.freshness_status] || source.freshness_status || '—')}</strong></div>
        <small>${esc(DATASET_NOTES[source.dataset] || '')}</small>
      </div>`).join('');
  };

  renderRankings = function() {
    const rows = rankingData();
    $('#rankingRows').innerHTML = rows.length ? rows.map(item => {
      const eligible = isScoreEligible(item.r);
      const horizons = availableHorizons(item.r);
      const status = modelStatus(item.r);
      const statusNote = status === 'PARTIAL_READY'
        ? `有效期間：${horizons.join('、')}`
        : status === 'NOT_DUE' ? '尚未形成正式排名' : '';
      return `<tr data-ticker="${esc(item.ticker)}" class="status-${status.toLowerCase().replace('_', '-')}">
        <td>${eligible && item.rank !== 999 ? item.rank : '—'}</td>
        <td class="ticker-cell">${esc(item.ticker)}</td>
        <td>${esc(item.company)}</td>
        <td>${esc(item.industry)}</td>
        <td class="num">${scoreHtml(item.r, item.alpha)}</td>
        <td class="num">${scoreHtml(item.r, item.momentum)}</td>
        <td class="num"><b>${scoreHtml(item.r, item.selection)}</b></td>
        <td class="num">${scoreHtml(item.r, item.divergence)}</td>
        <td class="status-cell" title="${esc(humanStatusReason(item.r))}">${pillStatus(status)}${statusNote ? `<small>${esc(statusNote)}</small>` : ''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="9"><div class="table-empty">沒有符合目前篩選條件的標的。</div></td></tr>';
    const filterLabel = state.rank.status === 'ALL' ? '全部狀態' : statusLabel(state.rank.status);
    $('#rankingCount').textContent = `${rows.length} / ${state.records.length} 檔 · ${filterLabel}`;
    $('#rankingFoot').textContent = `尺度：${state.rank.scale === 'formal' ? '正式尺度' : '跨產業可比尺度'} · 模型：${state.rank.model === 'consensus' ? '五模型共識' : MODELS[state.rank.model].zh} · 排序：${SORT_LABELS[state.rank.sort] || state.rank.sort} ${state.rank.dir === 1 ? '升冪' : '降冪'}`;
  };

  renderPool = function(view) {
    const records = state.records.filter(view === 'technology' ? isTechnology : record => !isTechnology(record));
    const target = view === 'technology' ? '#technologyContent' : '#outsideContent';
    $(view === 'technology' ? '#techCount' : '#outsideCount').textContent = `${records.length} 檔`;
    const eligible = records.filter(isScoreEligible);
    const top = eligible
      .filter(record => finite(record._models.formal.consensus.selection))
      .sort((a, b) => b._models.formal.consensus.selection - a._models.formal.consensus.selection)
      .slice(0, 30);
    const factorStats = Object.entries(FACTORS).map(([key, label]) => ({ label, value: mean(records.map(record => factor(record, key))) }));
    $(target).innerHTML = `
      <div class="pool-summary">
        ${metric('標的數', records.length, '正式研究範圍')}
        ${metric('可排名', eligible.length, '完整與部分歷史')}
        ${metric('部分歷史', records.filter(record => modelStatus(record) === 'PARTIAL_READY').length, '真實期間重算權重')}
        ${metric('尚未到期', records.filter(record => modelStatus(record) === 'NOT_DUE').length, '無正式綜合評分')}
        ${metric('產業數', new Set(records.map(industry)).size, '正式分類')}
      </div>
      <div class="pool-layout">
        <article class="panel no-top pool-table"><div class="panel-head"><div><h2>研究排名前 30 名</h2><p>點選股票代號可查看完整個股資料</p></div></div>
          <div class="table-wrap" role="region" aria-label="${view === 'technology' ? '科技股' : '其他股'}研究排名" tabindex="0"><table class="data-table"><thead><tr><th>排名</th><th>股票代號</th><th>公司</th><th>產業</th><th class="num">財務評分</th><th class="num">價格動能</th><th class="num">綜合評分</th><th>狀態</th></tr></thead><tbody>
            ${top.map(record => `<tr data-ticker="${esc(record.ticker)}"><td>${record._models.formal.consensus.rank}</td><td class="ticker-cell">${esc(record.ticker)}</td><td>${esc(record.company)}</td><td>${esc(industry(record))}</td><td class="num">${n(record._models.formal.consensus.alpha)}</td><td class="num">${n(record._momentum)}</td><td class="num"><b>${n(record._models.formal.consensus.selection)}</b></td><td>${pillStatus(modelStatus(record))}</td></tr>`).join('')}
          </tbody></table></div>
        </article>
        <aside class="side-card"><h3>平均因子</h3>${factorStats.map(item => `<div class="factor-stat"><div><span>${item.label}</span><b>${n(item.value)}</b></div><div class="bar"><i style="width:${Math.max(0, Math.min(100, item.value))}%"></i></div></div>`).join('')}</aside>
      </div>`;
  };

  renderModels = function() {
    const records = state.records.filter(isScoreEligible);
    $('#modelCards').innerHTML = Object.entries(MODELS).map(([key, model]) => {
      const average = mean(records.map(record => record._models.formal[key].selection));
      return `<article class="model-card"><span class="kicker">${esc(model.label)}</span><h3>${esc(model.zh)}</h3><p>${esc(model.desc)}</p>
        ${Object.entries(model.w).map(([factorKey, weight]) => `<div class="weight-line"><span>${esc(FACTORS[factorKey])}</span><div class="bar"><i style="width:${weight * 100}%"></i></div><b>${Math.round(weight * 100)}%</b></div>`).join('')}
        <div class="model-stat"><span>可評分母體平均</span><b>${n(average)}</b></div></article>`;
    }).join('');
    renderModelLab();
    const agreement = records
      .filter(record => finite(record._models.formal.consensus.selection))
      .sort((a, b) => a._models.formal.consensus.divergence - b._models.formal.consensus.divergence)
      .slice(0, 12);
    $('#modelAgreement').innerHTML = `<div class="agreement-grid">${agreement.map(record => {
      const topThree = Object.keys(MODELS).sort((a, b) => record._models.formal[b].selection - record._models.formal[a].selection).slice(0, 3);
      return `<div class="agreement-row" data-ticker="${esc(record.ticker)}"><b>${esc(record.ticker)}</b><div class="agree-dots">${Object.keys(MODELS).map(key => `<i class="${topThree.includes(key) ? 'on' : ''}" title="${esc(MODELS[key].zh)}"></i>`).join('')}</div><span>共識 ${n(record._models.formal.consensus.selection)}</span><span>分歧 ${n(record._models.formal.consensus.divergence)}</span></div>`;
    }).join('')}</div>`;
  };

  renderCompare = function() {
    const selected = state.compare.map(ticker => state.records.find(record => record.ticker === ticker)).filter(Boolean);
    $('#compareCounter').textContent = `${selected.length} / 4`;
    $('#compareChips').innerHTML = selected.map(record => `<span class="chip">${esc(record.ticker)}<button aria-label="移除 ${esc(record.ticker)}" data-remove="${esc(record.ticker)}">×</button></span>`).join('');
    $('#compareEmpty').classList.toggle('hidden', selected.length >= 2);
    $('#compareContent').classList.toggle('hidden', selected.length < 2);
    if (selected.length < 2) return;

    const rows = [];
    const section = label => rows.push({ label, section: true });
    const add = (label, values, options = {}) => rows.push({ label, values, ...options });
    const scoreFormat = (value, index) => scoreHtml(selected[index], value);
    const plainFormat = value => valueHtml(value);
    const returnFormat = value => valueHtml(value, pct, '尚未累積');
    const textFormat = value => esc(value || '—');

    section('資料狀態');
    add('模型狀態', selected.map(modelStatus), { format: value => `<span class="status-text">${esc(statusLabel(value))}</span>`, highlight: false });
    add('有效價格期間', selected.map(record => availableHorizons(record).join('、') || '尚無可用期間'), { format: textFormat, highlight: false });
    add('狀態說明', selected.map(humanStatusReason), { format: value => esc(value || '資料完整'), highlight: false });
    section('五模型');
    for (const [key, model] of Object.entries(MODELS)) {
      add(`${model.zh}財務評分`, selected.map(record => record._models.formal[key].alpha), { format: scoreFormat });
      add(`${model.zh}綜合評分`, selected.map(record => record._models.formal[key].selection), { format: scoreFormat });
    }
    section('五模型共識');
    add('共識財務評分', selected.map(record => record._models.formal.consensus.alpha), { format: scoreFormat });
    add('共識綜合評分', selected.map(record => record._models.formal.consensus.selection), { format: scoreFormat });
    add('模型分歧', selected.map(record => record._models.formal.consensus.divergence), { format: scoreFormat });
    section('五因子');
    for (const [key, label] of Object.entries(FACTORS)) add(label, selected.map(record => factor(record, key)), { format: plainFormat });
    section('價格動能');
    add('價格動能評分', selected.map(record => record._momentum), { format: scoreFormat });
    add('3 個月報酬', selected.map(record => record.momentum?.ret_3m), { format: returnFormat });
    add('6 個月報酬', selected.map(record => record.momentum?.ret_6m), { format: returnFormat });
    add('12 個月報酬', selected.map(record => record.momentum?.ret_12m), { format: returnFormat });
    section('估值');
    add('估值方法', selected.map(valuationMethod), { format: textFormat, highlight: false });
    add('估值狀態', selected.map(record => record.valuation?.status === 'READY' ? '可使用' : '部分可用'), { format: textFormat, highlight: false });

    const header = `<tr><th>比較項目</th>${selected.map(record => `<th><button class="compare-detail-link" data-compare-detail="${esc(record.ticker)}">${esc(record.ticker)}</button><span class="subtext">${esc(record.company)}</span></th>`).join('')}</tr>`;
    const body = rows.map(row => {
      if (row.section) return `<tr><td class="compare-section" colspan="${selected.length + 1}">${esc(row.label)}</td></tr>`;
      const candidates = row.values.map((value, index) => row.format === scoreFormat && !isScoreEligible(selected[index]) ? NaN : finite(value) ? Number(value) : NaN);
      const finiteCandidates = candidates.filter(Number.isFinite);
      const best = row.highlight === false || !finiteCandidates.length ? NaN : Math.max(...finiteCandidates);
      return `<tr><td>${esc(row.label)}</td>${row.values.map((value, index) => `<td class="${Number.isFinite(candidates[index]) && candidates[index] === best ? 'compare-best' : ''}">${row.format ? row.format(value, index) : n(value)}</td>`).join('')}</tr>`;
    }).join('');
    $('#compareContent').innerHTML = `
      <div class="capability-notice"><b>90 日風險：尚未公開</b><span>目前正式快照沒有可比較的風險數值，因此不顯示分數，也不標示優劣。</span></div>
      <div class="table-wrap compare-wrap" role="region" aria-label="個股比較表格" tabindex="0"><table class="compare-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
  };

  renderHistory = function() {
    const snapshot = state.snapshot;
    const partial = state.records.filter(record => modelStatus(record) === 'PARTIAL_READY');
    const notDue = state.records.filter(record => modelStatus(record) === 'NOT_DUE');
    $('#historyContent').innerHTML = `
      <div class="history-banner"><h2>目前只有 1 個正式市場快照</h2><p>目前公開資料日期為 ${esc(snapshot.market_key)}，快照版本為第 ${esc(snapshot.snapshot_revision)} 版。同一資料日期的修訂只更新當日結果，不會製造新的歷史日期。</p></div>
      <article class="panel"><div class="panel-head"><div><h2>正式快照時間軸</h2><p>歷史軸以正式市場日期為準</p></div>${pillStatus(snapshot.status === 'OFFICIAL' ? 'READY' : 'UNRESOLVED')}</div>
        <div class="timeline"><div class="timeline-row"><div class="timeline-date">${esc(snapshot.market_key)}</div><div class="timeline-line"><i></i></div><div class="timeline-info">第 ${esc(snapshot.snapshot_revision)} 版 · ${snapshot.model_resolved}/${state.records.length} 筆狀態已確認</div></div></div></article>
      <article class="panel"><div class="panel-head"><div><h2>本次資料狀態</h2><p>目前沒有上一個正式市場日期可作可信差異比較</p></div></div><div class="audit-list">
        <div class="audit-row"><span>完整可評分</span><b>${snapshot.model_ready}</b><b>可排名</b></div>
        <div class="audit-row"><span>部分歷史可評分</span><b>${snapshot.model_partial_ready}</b><b>${esc(partial.map(record => record.ticker).join('、'))}</b></div>
        <div class="audit-row"><span>尚未到期</span><b>${snapshot.model_not_due}</b><b>${esc(notDue.map(record => record.ticker).join('、'))}</b></div>
        <div class="audit-row"><span>資料未解決</span><b>${snapshot.model_unresolved}</b><b>無異常</b></div>
      </div></article>`;
  };

  function capabilityPill(status) {
    const cls = status === 'AVAILABLE' ? 'ok' : ['PARTIAL', 'REPORT_ONLY'].includes(status) ? 'warn' : status === 'NOT_EXPOSED' ? 'muted' : 'bad';
    return `<span class="pill ${cls}" data-capability-status="${esc(status)}" title="${esc(status)}">${esc(CAPABILITY_LABELS[status])}</span>`;
  }

  function renderCapabilityMatrix() {
    const total = state.records.length;
    const eligible = state.records.filter(isScoreEligible).length;
    const partial = state.records.filter(record => modelStatus(record) === 'PARTIAL_READY').length;
    const riskReady = state.records.filter(record => record.risk?.status === 'READY').length;
    const valuationReady = state.records.filter(record => record.valuation?.status === 'READY').length;
    const rows = [
      ['研究範圍', 'AVAILABLE', `${total}/${total}`, state.snapshot.market_key, '否', '全部標的皆可搜尋與查看'],
      ['正式研究排名', 'AVAILABLE', `${eligible}/${total}`, state.snapshot.market_key, '是', '完整與部分歷史標的可排名'],
      ['部分歷史標的', 'PARTIAL', `${partial}/${total}`, state.snapshot.market_key, '是', '只使用真實可用期間重新計算權重'],
      ['跨產業可比尺度', 'AVAILABLE', `${eligible}/${total}`, state.snapshot.market_key, '是', '可切換正式與跨產業可比尺度'],
      ['個股比較', 'AVAILABLE', `${total}/${total}`, state.snapshot.market_key, '不另排名', '可比較 2–4 檔；尚未到期者不顯示正式分數'],
      ['估值方法', valuationReady === total ? 'AVAILABLE' : 'PARTIAL', `${valuationReady}/${total}`, state.snapshot.market_key, '因子可用', '部分估值明細可能尚未公開'],
      ['90 日風險', riskReady ? 'PARTIAL' : 'NOT_EXPOSED', `${riskReady}/${total}`, state.snapshot.market_key, '否', '目前不顯示數值或比較優劣'],
      ['歷史趨勢', 'REPORT_ONLY', '1 個正式快照', state.snapshot.market_key, '否', '目前只顯示本次正式資料狀態'],
      ['投資組合', 'FUTURE', '0', '—', '否', '尚未接入正式持倉或候選名單']
    ];
    $('#capabilityMatrix').innerHTML = `<div class="table-wrap capability-wrap" role="region" aria-label="功能可用狀態表格" tabindex="0"><table class="capability-table"><thead><tr><th>功能</th><th>可用狀態</th><th>覆蓋範圍</th><th>資料日期</th><th>可否排名</th><th>目前呈現方式</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${esc(row[0])}</b></td><td>${capabilityPill(row[1])}</td><td>${esc(row[2])}</td><td>${esc(row[3])}</td><td>${esc(row[4])}</td><td>${esc(row[5])}</td></tr>`).join('')}</tbody></table></div>`;
  }

  renderAudit = function() {
    const records = state.records;
    const snapshot = state.snapshot;
    const eligible = records.filter(isScoreEligible).length;
    const riskReady = records.filter(record => record.risk?.status === 'READY').length;
    $('#auditMetrics').innerHTML = [
      metric('正式發布狀態', snapshot.publish_ready ? '可使用' : '不可使用', '目前正式快照'),
      metric('狀態已確認', `${snapshot.model_resolved}/${records.length}`, '全部研究範圍'),
      metric('可取得正式排名', `${eligible}/${records.length}`, '完整與部分歷史'),
      metric('網頁資料完整', `${snapshot.web_complete}/${records.length}`, '逐檔資料可讀'),
      metric('90 日風險', riskReady ? `${riskReady}/${records.length}` : '尚未公開', '不顯示數值或優劣')
    ].join('');
    $('#auditSources').innerHTML = state.manifest.sources.map(source => `<div class="audit-row"><span>${esc(DATASET_LABEL[source.dataset] || source.dataset)}</span><b>${esc(FRESHNESS_LABELS[source.freshness_status] || source.freshness_status || '—')}</b><b>${finite(source.coverage) ? Math.round(source.coverage * 100) + '%' : '—'}</b></div>`).join('');
    const coverage = [
      ['獲利能力', records.filter(record => finite(factor(record, 'profitability'))).length],
      ['財務穩健', records.filter(record => finite(factor(record, 'financial_strength'))).length],
      ['前瞻成長', records.filter(record => finite(factor(record, 'forward_growth'))).length],
      ['盈餘修正', records.filter(record => finite(factor(record, 'earnings_revision'))).length],
      ['相對估值', records.filter(record => finite(factor(record, 'valuation'))).length],
      ['價格動能可評分', records.filter(record => finite(record._momentum)).length],
      ['90 日風險', riskReady]
    ];
    $('#auditCoverage').innerHTML = coverage.map(([label, count]) => `<div class="audit-row"><span>${label}</span><b>${count}/${records.length}</b><b>${(count / records.length * 100).toFixed(1)}%</b></div>`).join('');
    renderCapabilityMatrix();
  };

  openDetail = function(ticker) {
    const record = state.records.find(item => item.ticker === ticker);
    if (!record) return;
    const status = modelStatus(record);
    const eligible = isScoreEligible(record);
    const horizons = availableHorizons(record);
    const reason = humanStatusReason(record);
    const modelRows = Object.entries(MODELS).map(([key, model]) => eligible ? `
      <div class="model-detail-row"><b>${esc(model.zh)}</b><div class="bar"><i style="width:${Math.max(0, Math.min(100, record._models.formal[key].selection))}%"></i></div><span>財務 ${n(record._models.formal[key].alpha)}</span><strong>綜合 ${n(record._models.formal[key].selection)}</strong></div>` : `
      <div class="model-detail-row unavailable"><b>${esc(model.zh)}</b><span class="model-unavailable">尚未形成正式綜合評分</span></div>`).join('');
    const exception = status === 'READY' ? '' : `
      <div class="exception-card ${status === 'PARTIAL_READY' ? 'partial' : 'not-due'}">
        <b>${esc(statusLabel(status))}</b>
        <span>${esc(reason)}</span>
        <small>${horizons.length ? `本次有效價格期間：${horizons.join('、')}；正式權重已依可用期間重新計算。` : '目前尚無到期的價格期間，因此不產生正式綜合評分與排名。'}</small>
      </div>`;
    const momentumBoxes = [
      ['3 個月', record.momentum?.ret_3m], ['6 個月', record.momentum?.ret_6m], ['12 個月', record.momentum?.ret_12m]
    ].map(([label, value]) => `<div class="detail-box"><span>${label}報酬</span><b>${finite(value) ? pct(value) : '尚未累積'}</b></div>`).join('');
    $('#detailContent').innerHTML = `
      <span class="kicker">${esc(industry(record))} · ${esc(sector(record))}</span>
      <div class="detail-ticker">${esc(record.ticker)}</div><div class="detail-company">${esc(record.company)}</div>${pillStatus(status)}${exception}
      <div class="detail-section"><h3>五模型</h3>${modelRows}<div class="note-box">${eligible ? `五模型共識綜合評分 ${n(record._models.formal.consensus.selection)}，模型分歧 ${n(record._models.formal.consensus.divergence)}。綜合評分維持 70% 財務評分與 30% 價格動能。` : '財務因子仍可作研究參考，但因價格歷史尚未到期，不形成正式綜合評分與排名。'}</div></div>
      <div class="detail-section"><h3>五個底層因子</h3><div class="detail-grid">${Object.entries(FACTORS).map(([key, label]) => `<div class="detail-box"><span>${label}</span><b>${n(factor(record, key))}</b></div>`).join('')}<div class="detail-box"><span>價格動能評分</span><b>${eligible ? n(record._momentum) : '尚未評分'}</b></div></div>${eligible ? '' : '<div class="neutral-note">以上財務因子不代表此標的已有正式綜合評分或排名。</div>'}</div>
      <div class="detail-section"><h3>價格動能</h3><div class="detail-grid">${momentumBoxes}</div></div>
      <div class="detail-section"><h3>90 日風險</h3><div class="capability-notice"><b>尚未公開</b><span>目前正式快照沒有 90 日風險數值，因此不顯示分數、波動率或下行風險。</span></div></div>
      <div class="detail-section"><h3>相對估值方法</h3><div class="detail-grid"><div class="detail-box"><span>預估本益比</span><b>${finite(record.valuation?.current_forward_pe) ? n(record.valuation.current_forward_pe, 2) + 'x' : '尚未提供'}</b></div><div class="detail-box"><span>企業價值／稅息折舊攤銷前利潤</span><b>${finite(record.valuation?.ev_ebitda) ? n(record.valuation.ev_ebitda, 2) + 'x' : '尚未提供'}</b></div></div><div class="note-box">正式估值方法：${esc(valuationMethod(record))}<br>${esc(record.valuation?.reason || '')}</div></div>
      <div class="detail-section"><h3>跨產業可比尺度</h3>${eligible ? `<div class="detail-grid"><div class="detail-box"><span>可比財務評分</span><b>${n(record._models.comparable.consensus.alpha)}</b></div><div class="detail-box"><span>可比綜合評分</span><b>${n(record._models.comparable.consensus.selection)}</b></div><div class="detail-box"><span>可比分歧</span><b>${n(record._models.comparable.consensus.divergence)}</b></div></div>` : '<div class="neutral-note">價格歷史尚未到期，因此不顯示正式可比綜合評分。</div>'}</div>`;
    $('#detailDrawer').classList.add('open');
    $('#detailBackdrop').classList.add('open');
    $('#detailDrawer').setAttribute('aria-hidden', 'false');
    $('#detailClose').focus();
  };

  renderCommand = function() {
    const matches = commandMatches();
    state.commandIndex = Math.min(state.commandIndex, Math.max(0, matches.length - 1));
    $('#commandResults').innerHTML = matches.length ? matches.map((record, index) => `
      <div class="command-row ${index === state.commandIndex ? 'sel' : ''}" data-command="${esc(record.ticker)}">
        <div><b>${esc(record.ticker)} · ${esc(record.company)}</b><small>${esc(industry(record))} · ${esc(statusLabel(modelStatus(record)))}</small></div>
        <span>${isScoreEligible(record) ? n(record._models.formal.consensus.selection) : '尚未評分'}</span>
      </div>`).join('') : '<div class="command-empty">沒有符合的標的。</div>';
  };

  exportCSV = function() {
    const rows = rankingData();
    const header = ['排名', '股票代號', '公司', '產業', '財務評分', '價格動能', '綜合評分', '模型分歧', '資料狀態', '狀態說明', '有效價格期間', '資料日期', '快照代號', '排名尺度', '模型'];
    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(quote).join(',')];
    rows.forEach(item => {
      const eligible = isScoreEligible(item.r);
      lines.push([
        eligible && item.rank !== 999 ? item.rank : '', item.ticker, item.company, item.industry,
        eligible ? item.alpha : '', eligible ? item.momentum : '', eligible ? item.selection : '', eligible ? item.divergence : '',
        modelStatus(item.r), humanStatusReason(item.r), availableHorizons(item.r).join('、'), state.snapshot.market_key,
        state.snapshot.snapshot_id || '', state.rank.scale === 'formal' ? '正式尺度' : '跨產業可比尺度',
        state.rank.model === 'consensus' ? '五模型共識' : MODELS[state.rank.model].zh
      ].map(quote).join(','));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ForwardAlpha_研究排名_${state.snapshot.market_key}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  };

  bind = function() {
    legacyBind();
    document.addEventListener('click', event => {
      const detail = event.target.closest('[data-compare-detail]');
      if (detail) openDetail(detail.dataset.compareDetail);
    });
  };
})();
