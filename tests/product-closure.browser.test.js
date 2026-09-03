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

(async () => {
  const server = await startServer();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true });
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

    await page.locator('#rankStatus').selectOption('NOT_DUE');
    assert.equal(await page.locator('#rankingRows tr[data-ticker]').count(), 6);
    assert.equal(await page.locator('#rankingRows [data-status="NOT_DUE"]').count(), 6);
    assert.equal(await page.locator('#rankingRows .score-unavailable').count(), 24);
    for (const text of await page.locator('#rankingRows tr[data-ticker]').allInnerTexts()) {
      assert.match(text, /尚未評分/);
      assert.match(text, /尚未形成正式排名/);
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
      tickerPosition: getComputedStyle(document.querySelector('.ranking-table td:nth-child(2)')).position
    }));
    assert(dimensions.documentWidth <= dimensions.viewport, `mobile document overflows: ${JSON.stringify(dimensions)}`);
    assert(dimensions.tableScroll > dimensions.tableClient, 'ranking table should scroll inside its own region');
    assert.equal(dimensions.tickerPosition, 'sticky');
    await mobile.locator('#rankingRows tr[data-ticker]').first().click();
    await mobile.locator('#detailDrawer.open').waitFor();
    const drawerWidth = await mobile.locator('#detailDrawer').evaluate(element => element.getBoundingClientRect().width);
    assert(drawerWidth <= dimensions.viewport);
    if (process.env.SCREENSHOT_DIR) {
      await mobile.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'work-b-mobile-detail.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('product closure browser tests OK');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
