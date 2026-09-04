'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function startServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function addCompare(page, ticker) {
  await page.locator('#compareSearch').fill(ticker);
  await page.locator(`[data-add="${ticker}"]`).click();
}

function parseCsv(buffer) {
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'CSV UTF-8 BOM missing');
  const text = buffer.subarray(3).toString('utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const cells = [];
    let index = 0;
    while (index < line.length) {
      assert.equal(line[index], '"', `CSV field must start with a quote: ${line}`);
      index += 1;
      let value = '';
      while (index < line.length) {
        if (line[index] !== '"') {
          value += line[index++];
        } else if (line[index + 1] === '"') {
          value += '"';
          index += 2;
        } else {
          index += 1;
          break;
        }
      }
      cells.push(value);
      if (line[index] === ',') index += 1;
    }
    return cells;
  });
}

async function downloadCsv(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#rankCsv').click();
  const download = await downloadPromise;
  return { filename: download.suggestedFilename(), buffer: fs.readFileSync(await download.path()) };
}

(async () => {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  const errors = [];
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.locator('html[data-ready="true"]').waitFor();
    assert.equal(await page.locator('#rankingRows tr').count(), 937);
    assert.match(await page.locator('#overviewMetrics').innerText(), /可取得正式排名\s*931/);
    assert.match(await page.locator('#overviewMetrics').innerText(), /部分歷史可評分\s*12/);

    await page.locator('#mainNav [data-view="rankings"]').click();
    await page.locator('#rankStatus').selectOption('PARTIAL_READY');
    assert.equal(await page.locator('#rankingRows tr[data-ticker]').count(), 12);
    assert.equal(await page.locator('#rankingRows [data-status="PARTIAL_READY"]').count(), 12);
    assert.equal(await page.locator('#rankingRows .score-unavailable').count(), 0);
    await page.locator('#rankingRows tr[data-ticker]').first().click();
    await page.locator('#detailDrawer.open').waitFor();
    assert.match(await page.locator('#detailContent').innerText(), /本次有效價格期間/);
    assert.match(await page.locator('#detailContent').innerText(), /新上市/);
    await page.locator('#detailClose').click();

    await page.locator('#mainNav [data-view="models"]').click();
    assert.equal(await page.locator('#modelCards .model-card').count(), 5);
    assert.equal(await page.locator('#modelTopList .leader-row').count(), 15);
    const factorGuide = await page.locator('.factor-guide').innerText();
    for (const label of ['獲利能力', '財務穩健', '前瞻成長', '盈餘修正', '相對估值']) assert.match(factorGuide, new RegExp(label));
    assert.match(factorGuide, /分數越高/);
    assert.match(factorGuide, /不構成投資建議/);

    await page.locator('#mainNav [data-view="rankings"]').click();
    await page.locator('#rankStatus').selectOption('PARTIAL_READY');
    await page.locator('#rankScale').selectOption('comparable');
    assert.equal(await page.locator('#rankingRows tr[data-ticker]').count(), 12);

    const partialDownload = await downloadCsv(page);
    assert.match(partialDownload.filename, /^ForwardAlpha_研究排名_2026-09-02\.csv$/);
    const partialCsv = parseCsv(partialDownload.buffer);
    assert.deepEqual(partialCsv[0], ['排名', '股票代號', '公司', '產業', '財務評分', '價格動能', '綜合評分', '模型分歧', '資料狀態', '狀態說明', '有效價格期間', '資料日期', '快照代號', '排名尺度', '模型']);
    assert.equal(partialCsv.length, 13);
    for (const row of partialCsv.slice(1)) {
      assert(row[0], `${row[1]} PARTIAL_READY rank missing from CSV`);
      assert.equal(row[8], 'PARTIAL_READY');
      assert(row[9], `${row[1]} PARTIAL_READY reason missing from CSV`);
      assert(row[10], `${row[1]} PARTIAL_READY horizon missing from CSV`);
    }

    await page.locator('#rankStatus').selectOption('NOT_DUE');
    assert.equal(await page.locator('#rankingRows tr[data-ticker]').count(), 6);
    assert.equal(await page.locator('#rankingRows [data-status="NOT_DUE"]').count(), 6);
    assert.equal(await page.locator('#rankingRows .score-unavailable').count(), 24);
    for (const text of await page.locator('#rankingRows tr[data-ticker]').allInnerTexts()) {
      assert.match(text, /尚未評分/);
      assert.match(text, /尚未形成正式排名/);
    }
    const notDueDownload = await downloadCsv(page);
    assert.match(notDueDownload.filename, /^ForwardAlpha_研究排名_2026-09-02\.csv$/);
    const notDueCsv = parseCsv(notDueDownload.buffer);
    assert.equal(notDueCsv.length, 7);
    for (const row of notDueCsv.slice(1)) {
      assert.equal(row[0], '', `${row[1]} NOT_DUE rank leaked to CSV`);
      for (const index of [4, 5, 6, 7]) assert.equal(row[index], '', `${row[1]} NOT_DUE score leaked to CSV column ${index}`);
      assert.equal(row[8], 'NOT_DUE');
      assert(row[9], `${row[1]} NOT_DUE reason missing from CSV`);
      assert.equal(row[10], '');
    }

    await page.locator('#mainNav [data-view="compare"]').click();
    await addCompare(page, 'NVDA');
    await addCompare(page, 'ARXS');
    await addCompare(page, 'BSP');
    await page.locator('#compareContent:not(.hidden)').waitFor();
    const compareText = await page.locator('#compareContent').innerText();
    assert.match(compareText, /90 日風險：尚未公開/);
    assert.match(compareText, /部分歷史可評分/);
    assert.match(compareText, /尚未到期/);
    assert.match(compareText, /尚未評分/);
    assert(!compareText.includes('Risk Score'));
    await page.locator('[data-compare-detail="BSP"]').click();
    assert.match(await page.locator('#detailContent').innerText(), /不產生正式綜合評分與排名/);
    assert.match(await page.locator('#detailContent').innerText(), /90 日風險\s*尚未公開/);
    await page.locator('#detailClose').click();

    await page.locator('#mainNav [data-view="audit"]').click();
    assert.equal(await page.locator('#capabilityMatrix tbody tr').count(), 9);
    const riskRow = page.locator('#capabilityMatrix tbody tr').filter({ hasText: '90 日風險' });
    assert.match(await riskRow.innerText(), /尚未公開/);
    assert.match(await page.locator('#capabilityMatrix').innerText(), /931\/937/);

    await page.locator('#globalSearchBtn').click();
    await page.locator('#commandInput').fill('QNT');
    await page.locator('#commandInput').press('Enter');
    await page.locator('#detailDrawer.open').waitFor();
    assert.match(await page.locator('#detailContent').innerText(), /QNT/);
    assert.match(await page.locator('#detailContent').innerText(), /尚未到期/);

    const screenshotDir = process.env.SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.locator('#detailClose').click();
      await page.waitForTimeout(250);
      await page.locator('#mainNav [data-view="rankings"]').click();
      await page.locator('#rankStatus').selectOption('PARTIAL_READY');
      await page.screenshot({ path: path.join(screenshotDir, 'work-b-desktop-rankings.png'), fullPage: true });
    }

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    mobile.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobile.locator('html[data-ready="true"]').waitFor();
    await mobile.locator('#mainNav [data-view="rankings"]').click();
    await mobile.locator('#rankStatus').selectOption('PARTIAL_READY');
    assert.equal(await mobile.locator('#rankingRows tr[data-ticker]').count(), 12);
    const dimensions = await mobile.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      tableClient: document.querySelector('#rankings .table-wrap').clientWidth,
      tableScroll: document.querySelector('#rankings .table-wrap').scrollWidth,
      tickerPosition: getComputedStyle(document.querySelector('.ranking-table td:nth-child(2)')).position,
      navTarget: document.querySelector('#mainNav button').getBoundingClientRect().height,
      inputTarget: document.querySelector('#rankSearch').getBoundingClientRect().height,
      selectTarget: document.querySelector('#rankStatus').getBoundingClientRect().height,
      buttonTarget: document.querySelector('#rankReset').getBoundingClientRect().height
    }));
    assert(dimensions.documentWidth <= dimensions.viewport, `mobile document overflows: ${JSON.stringify(dimensions)}`);
    assert(dimensions.tableScroll > dimensions.tableClient, 'ranking table should scroll inside its own region');
    assert.equal(dimensions.tickerPosition, 'sticky');
    for (const key of ['navTarget', 'inputTarget', 'selectTarget', 'buttonTarget']) {
      assert(dimensions[key] >= 42, `${key} is below 42px: ${JSON.stringify(dimensions)}`);
    }
    await mobile.locator('#rankingRows tr[data-ticker]').first().click();
    await mobile.locator('#detailDrawer.open').waitFor();
    await mobile.waitForTimeout(250);
    const drawerBounds = await mobile.locator('#detailDrawer').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    assert(drawerBounds.width <= dimensions.viewport, `detail drawer width overflows: ${JSON.stringify({ drawerBounds, viewport: dimensions.viewport })}`);
    assert(drawerBounds.left >= 0 && drawerBounds.right <= dimensions.viewport, `detail drawer position overflows: ${JSON.stringify({ drawerBounds, viewport: dimensions.viewport })}`);
    const closeTarget = await mobile.locator('#detailClose').evaluate(element => element.getBoundingClientRect().height);
    assert(closeTarget >= 44, `detail close target is below 44px: ${closeTarget}`);
    if (process.env.SCREENSHOT_DIR) {
      await mobile.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'work-b-mobile-detail.png') });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({
      status: 'PASS',
      desktop: { records: 937, partialReady: 12, notDue: 6, models: 5, modelLeaders: 15 },
      csv: {
        filename: partialDownload.filename,
        utf8Bom: true,
        chineseHeaders: true,
        partialReadyRows: partialCsv.length - 1,
        notDueRows: notDueCsv.length - 1,
        notDueFormalScoresBlank: true
      },
      mobile: { ...dimensions, drawerBounds, closeTarget },
      consoleAndPageErrors: errors.length
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
