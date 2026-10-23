const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const response = await page.goto('https://www.engineer-service-report.top:10443/', { timeout: 60000 });
    assert.equal(response.status(), 200);
    const signalHeaders = await page.locator('#page-signals th').allTextContents();
    assert.equal(signalHeaders.includes('无传感器'), false);
    assert.equal(signalHeaders.includes('启用'), false);
    assert.equal(await page.locator('#signalsBody [data-k="no_sensor"], #signalsBody [data-k="active"]').count(), 0);
    await page.waitForFunction(() => window.__state?.signals?.length > 0);
    await page.evaluate(() => renderSignalTable());
    await page.locator('#signalsBody tr').first().waitFor({ state: 'attached' });
    await page.setViewportSize({ width: 390, height: 844 });
    const signalLayout = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.page')];
      const previous = pages.map(el => el.style.display);
      pages.forEach(el => { el.style.display = el.id === 'page-signals' ? 'block' : 'none'; });
      const table = document.querySelector('#signalsTable');
      const wrap = document.querySelector('#signalsTableWrap');
      wrap.scrollLeft = 200;
      const result = { table: getComputedStyle(table).display, header: getComputedStyle(table.tHead).display,
        row: getComputedStyle(table.tBodies[0].rows[0]).display, scrollLeft: wrap.scrollLeft,
        pageFits: document.documentElement.scrollWidth <= innerWidth };
      pages.forEach((el, i) => { el.style.display = previous[i]; });
      return result;
    });
    assert.equal(signalLayout.table, 'table');
    assert.equal(signalLayout.header, 'table-header-group');
    assert.equal(signalLayout.row, 'table-row');
    assert.ok(signalLayout.scrollLeft > 0 && signalLayout.pageFits);
    await page.setViewportSize({ width: 1280, height: 844 });
    assert.equal(signalHeaders[signalHeaders.indexOf('传感器类型') + 1], '程序名称');
    const signalResponse = await page.request.get('https://www.engineer-service-report.top:10443/api/signal-types');
    const signals = (await signalResponse.json()).items;
    assert.ok(signals.every(signal => typeof signal.program_name === 'string'));
    const reorderResponse = await page.request.post('https://www.engineer-service-report.top:10443/api/config/projects/reorder', { data: { ids: [] } });
    assert.equal(reorderResponse.status(), 401);
    await page.locator('#treeBody .tree-node.project').first().waitFor();
    assert.equal(await page.evaluate(() => typeof finishProjectDrag), 'function');
    assert.equal(await page.evaluate(() => typeof finishCabinetDrag), 'function');
    assert.equal(await page.locator('#loginView').isVisible(), false);
    const projectId = await page.evaluate(() => window.__state.tree.find(p => p.module_count > 0)?.id);
    if (!projectId) {
      assert.deepEqual(errors, []);
      console.log('Public HTTPS check passed: trusted certificate, anonymous startup, configuration fields and login protection. No modules exist; module navigation checks skipped. No production data changed.');
      return;
    }
    await page.locator(`[data-project-overview="${projectId}"] .act-open`).click();
    assert.ok(await page.locator(`.cabinet-tree-item[data-project="${projectId}"] .cabinet-drag-label`).count() > 0);
    const projectExportPromise = page.waitForEvent('download');
    await page.locator('#overviewExportBtn').click();
    const projectExport = await projectExportPromise;
    assert.ok(projectExport.url().includes(`project_id=${projectId}`));
    assert.match(projectExport.suggestedFilename(), /\.xlsx$/);
    const projectWorkbook = fs.readFileSync(await projectExport.path());
    assert.equal(projectWorkbook.readUInt32LE(0), 0x04034b50);
    assert.ok(projectWorkbook.includes(Buffer.from('xl/worksheets/sheet1.xml')));
    assert.ok(projectWorkbook.includes(Buffer.from('xl/worksheets/sheet2.xml')));
    await page.locator('[data-cabinet-overview] .act-open').first().click();
    const cabinetExportPromise = page.waitForEvent('download');
    await page.locator('#overviewExportBtn').click();
    const cabinetExport = await cabinetExportPromise;
    assert.ok(cabinetExport.url().includes('cabinet_id='));
    assert.match(cabinetExport.suggestedFilename(), /\.xlsx$/);
    await page.locator('[data-module] .act-open').first().click();
    await page.locator('#pointsBody tr').first().waitFor();
    assert.equal(await page.locator('#addPointBtn').count(), 0);
    assert.ok(await page.evaluate(() => window.__state.points.every(row => typeof row.plc_expression === 'string')));
    assert.ok(await page.evaluate(() => window.__state.points.every(row => !/:QW?\./.test(row.plc_expression))));
    for (const row of await page.evaluate(() => window.__state.points)) {
      const program = signals.find(signal => signal.id === row.signal_type_id)?.program_name?.trim();
      const match = row.point_name?.trim().match(/^([A-Za-z])(\d+)$/);
      if (program && match) assert.ok(row.plc_expression.includes(`${program}_${match[1]}${match[2].padStart(5, '0')}`));
    }
    const moduleType = await page.evaluate(() => findModuleInTree(window.__state.currentModuleId)?.module.module_type_name);
    for (const row of await page.evaluate(() => window.__state.points)) {
      if ((!row.point_name.trim() || !row.signal_type_id) && ['DI', 'DO'].includes(moduleType)) {
        const address = row.plc_point.trim().replace(/:Q(?=W?\.)/g, ':O');
        assert.equal(row.plc_expression, moduleType === 'DI' ? `//Spare:=${address};` : `//${address}:=Spare;`);
      }
    }
    const firstExpression = await page.evaluate(() => window.__state.points[0].plc_expression);
    assert.equal(await page.locator('#pointsBody .cell-plc-expression').first().inputValue(), firstExpression);
    await page.locator('[data-page=options]').click();
    await page.locator('#loginView').waitFor();
    await page.locator('#cancelLogin').click();
    assert.equal(await page.locator('#page-points').isVisible(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#pointsBody tr').first().waitFor();
    assert.equal(await page.locator('#pointsTable').evaluate(table => getComputedStyle(table).display), 'table');
    assert.equal(await page.locator('#pointsTable thead').evaluate(header => getComputedStyle(header).display), 'table-header-group');
    assert.equal(await page.locator('#pointsBody tr').first().evaluate(row => getComputedStyle(row).display), 'table-row');
    assert.ok(await page.locator('#pointsTable').evaluate(table => table.getBoundingClientRect().width <= 740));
    assert.equal(await page.locator('.signal-choice-label').first().evaluate(label => getComputedStyle(label).webkitLineClamp), '2');
    assert.ok(await page.locator('#tableWrap').evaluate(wrap => { wrap.scrollLeft = 200; return wrap.scrollLeft > 0; }));
    await page.locator('#navToggle').click();
    await page.locator('[data-page=options]').click();
    await page.locator('#loginView').waitFor();
    await page.locator('#cancelLogin').click();
    assert.deepEqual(errors, []);
    console.log('Public HTTPS browser check passed: trusted certificate, anonymous startup, project/cabinet/module navigation, points loaded, configuration login, mobile navigation. No production data changed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
