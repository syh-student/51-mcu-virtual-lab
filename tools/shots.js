/* 生成 README 用的真实界面截图：直接用 Chrome 渲染本地构建产物 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const fileUrl = name => pathToFileURL(path.join(ROOT, name)).href;

async function shot(browser, file, hash, width, height, dpr, out, after) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr });
  await page.goto(fileUrl(file) + (hash || ''), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 900));
  if (after) await after(page);
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT, out) });
  const size = fs.statSync(path.join(OUT, out)).size;
  console.log(`${out}  ${width}x${height}@${dpr}  ${(size / 1024).toFixed(0)} KB`);
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new' });

  /* 1. 写代码页：LCD 例程，能看到树 / 编辑器 / 编译输出 */
  await shot(browser, 'index.html', '#ex=lcd&page=code', 1440, 900, 1, 'code.png');

  /* 2. 开发板页：功能板的 LCD 正在显示两行文字 */
  await shot(browser, 'index.html', '#ex=lcd&page=board', 1440, 900, 1, 'board.png', async p => {
    await p.evaluate(() => { const b = document.getElementById('btn-run'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 700));
  });

  /* 3. 引脚板：40 脚实物排布 */
  await shot(browser, 'index.html', '#ex=led-flow&page=board', 1440, 900, 1, 'pins.png', async p => {
    await p.evaluate(() => {
      const t = document.querySelector('#board-view-tabs [data-view="pin"]');
      if (t) t.click();
    });
    await new Promise(r => setTimeout(r, 1600));
    await p.evaluate(() => { const b = document.getElementById('btn-run'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 800));
  });

  /* 4. 时序图：流水灯在 P2 口上的电平变化 */
  await shot(browser, 'index.html', '#ex=led-flow&page=scope', 1440, 900, 1, 'scope.png', async p => {
    await p.evaluate(() => { const b = document.getElementById('btn-run'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 2200));
  });

  /* 5. 硬件实验室：电路实验台 */
  await shot(browser, 'hardware.html', '', 1440, 900, 1, 'hardware.png');

  /* 6. 移动端：开发板竖屏 */
  await shot(browser, 'index.html', '#ex=nixie&page=board', 414, 896, 2, 'mobile.png', async p => {
    await p.evaluate(() => { const b = document.getElementById('btn-run'); if (b) b.click(); });
    await new Promise(r => setTimeout(r, 700));
  });

  await browser.close();
})().catch(e => { console.error('截图失败:', e); process.exit(1); });
