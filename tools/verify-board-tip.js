/* 验证：悬停说明回到固定说明条，不再有跟随鼠标的黑色浮层。 */
const puppeteer = require('puppeteer');
const path = require('path');

const base = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
function assert(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) process.exitCode = 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(base + '#page=board', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('#board svg', { timeout: 20000 });
  await sleep(400);

  assert('已移除跟随鼠标的浮层元素', !(await page.$('#board-float')));

  const geo = await page.evaluate(() => {
    const svg = document.querySelector('#board svg');
    const r = svg.getBoundingClientRect();
    const k = Math.min(r.width / 656, r.height / 722);
    const ox = (r.width - 656 * k) / 2, oy = (r.height - 722 * k) / 2;
    const tip = document.getElementById('board-tip');
    const cs = getComputedStyle(tip);
    const tr = tip.getBoundingClientRect();
    const wrap = document.getElementById('board-wrap').getBoundingClientRect();
    return {
      x: r.left + ox + 68 * k,
      y: r.top + oy + 343 * k,
      pos: cs.position,
      tipTop: tr.top, tipBottom: tr.bottom, wrapBottom: wrap.bottom,
    };
  });
  assert('说明条不是绝对定位浮层', geo.pos !== 'absolute', geo.pos);
  assert('说明条位于板面下方', geo.tipTop >= geo.wrapBottom - 2, geo.tipTop + ' / ' + geo.wrapBottom);

  await page.mouse.move(geo.x, geo.y, { steps: 6 });
  await sleep(400);
  const tipText = await page.$eval('#board-tip', (el) => el.textContent);
  assert('悬停蜂鸣器后说明条更新', tipText.includes('蜂鸣器'), tipText.slice(0, 30));
  assert('悬停后仍无浮层', !(await page.$('#board-float')));

  await page.screenshot({ path: path.resolve(__dirname, '..', '..', 'board-tip-fixed.png') });
  await browser.close();
  console.log('说明条回归验证结束，截图 board-tip-fixed.png');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
