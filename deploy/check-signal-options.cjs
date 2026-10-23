const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://www.engineer-service-report.top:10443/', { timeout: 60000 });
    await page.waitForFunction(() => window.__state?.tree?.length && window.__state.signals.length && window.__state.config?.parts?.length, { timeout: 60000 });
    const results = await page.evaluate(async () => {
      const modules = window.__state.tree.flatMap(p => p.cabinets.flatMap(c => c.modules));
      const module = modules[0];
      if (!module) throw new Error('没有可检查的模块');
      window.__state.currentModuleId = module.id;
      const response = await fetch(`/api/points?module_id=${module.id}`);
      window.__state.points = (await response.json()).items;
      const originalType = module.module_type_name;
      const originalPoints = window.__state.points;
      const results = [];
      try {
        // 仅改变测试浏览器内存中的显示上下文，不发送数据写入请求。
        for (const type of ['DI', 'DO']) {
          module.module_type_name = type;
          for (const part of window.__state.config.parts) {
            window.__state.points = originalPoints.map(row => ({ ...row, part: part.param }));
            renderPoints();
            const names = [...document.querySelectorAll('#pointsBody tr:first-child [data-k="signal_type_id"] option')]
              .filter(option => option.value).map(option => option.textContent);
            const expected = window.__state.signals.filter(signal => signal.active && signal.part_id === part.id
              && signal.name.trim().toUpperCase().endsWith(type)).map(signal => signal.name);
            results.push({ type, part: part.name, names, expected });
          }
        }
      } finally {
        module.module_type_name = originalType;
        window.__state.points = originalPoints;
        renderPoints();
      }
      return results;
    });
    for (const result of results) {
      assert.deepEqual(result.names, result.expected);
      assert.ok(result.names.length > 0);
      assert.ok(result.names.every(name => name.trim().toUpperCase().endsWith(result.type)));
      console.log(`${result.type} / ${result.part}: ${result.names.join(', ')}`);
    }
    console.log('Live dropdown filtering passed for DI/DO and each part. No production data changed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
