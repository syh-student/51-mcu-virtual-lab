/* 真实浏览器验证批次 2：浅色主题、当前行高亮、工程快照、PWA 离线 */
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, msg) => { if (!cond) failed++; console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'load' });
  await sleep(700);

  /* ---------- 1. 浅色主题 ---------- */
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click('#btn-theme');
  await sleep(250);
  const light = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('light'),
    bg: getComputedStyle(document.body).backgroundColor,
    store: localStorage.getItem('c51.theme'),
    kw: (document.querySelector('#hl .hl-k') ? getComputedStyle(document.querySelector('#hl .hl-k')).color : '')
  }));
  console.log('    深色背景 ' + darkBg + ' → 浅色背景 ' + light.bg + '；关键字色 ' + light.kw);
  ok(light.cls && light.bg !== darkBg, '点 ◐ 后切到浅色主题，背景色改变');
  ok(light.store === 'light', '主题写进了 localStorage');
  ok(light.kw === 'rgb(194, 65, 12)', '浅色下代码关键字换成深色配色');
  await page.reload({ waitUntil: 'load' });
  await sleep(500);
  ok(await page.evaluate(() => document.documentElement.classList.contains('light')), '刷新后浅色主题仍在');
  await page.click('#btn-theme');
  await sleep(200);
  ok(!(await page.evaluate(() => document.documentElement.classList.contains('light'))), '再点一次回到深色');

  /* ---------- 2. 当前行高亮 ---------- */
  await page.evaluate(() => {
    const el = document.getElementById('code');
    el.value = 'void main(void) {\n  int i;\n  i = 1;\n  while (1) { }\n}\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    el.selectionStart = el.selectionEnd = 0;
  });
  await sleep(200);
  const top1 = await page.evaluate(() => {
    const f = document.querySelector('#marks i.focus');
    return f ? f.style.top : '';
  });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await sleep(250);
  const top2 = await page.evaluate(() => {
    const f = document.querySelector('#marks i.focus');
    return f ? f.style.top : '';
  });
  console.log('    光标第 1 行 top=' + top1 + '，按两次 ↓ 后 top=' + top2);
  ok(!!top1 && !!top2 && top1 !== top2, '当前行高亮跟着光标移动');

  /* ---------- 3. 工程快照 ---------- */
  const before = await page.evaluate(() => document.getElementById('code').value);
  await page.click('#btn-snap');
  await sleep(250);
  ok(await page.evaluate(() => document.getElementById('dlg-snap').classList.contains('on')), '快照对话框打开');
  await page.evaluate(() => { document.getElementById('snap-name').value = '验证快照'; });
  await page.click('#snap-save');
  await sleep(300);
  const snapStored = await page.evaluate(() => localStorage.getItem('c51.snapshots') || '');
  ok(snapStored.includes('验证快照'), '快照写进了 localStorage');
  await page.evaluate(() => {
    const el = document.getElementById('code');
    el.value = '// 改乱了\n';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.snap-row button')];
    const b = btns.find(x => x.textContent === '恢复');
    if (b) b.click();
  });
  await sleep(300);
  await page.evaluate(() => { const b = document.getElementById('dlg-ok'); if (b) b.click(); });
  await sleep(500);
  const after = await page.evaluate(() => document.getElementById('code').value);
  ok(after === before, '恢复快照后代码回到保存时的样子');
  ok(!(await page.evaluate(() => document.getElementById('dlg-snap').classList.contains('on'))), '恢复后快照对话框自动关闭');
  await page.click('#btn-snap');
  await sleep(250);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.snap-row button')];
    const b = btns.find(x => x.textContent === '删除');
    if (b) b.click();
  });
  await sleep(250);
  ok(await page.evaluate(() => document.getElementById('snap-list').textContent.includes('还没有快照')), '删除后快照列表为空');
  await page.click('#snap-close');
  await sleep(150);

  /* ---------- 4. PWA：http 下注册 + 离线打开 ---------- */
  const server = spawn('python', ['-m', 'http.server', '8123', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(1500);
  try {
    await page.goto('http://127.0.0.1:8123/index.html', { waitUntil: 'load' });
    await sleep(1500);
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!(reg && reg.active);
    });
    ok(swReady, 'http 下 Service Worker 注册成功');
    const keys = await page.evaluate(() => caches.keys());
    console.log('    缓存：' + keys.join(', '));
    ok(keys.some(k => k.startsWith('c51lab-')), '离线缓存已建立');
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'load' });
    await sleep(800);
    const offline = await page.evaluate(() => ({
      title: document.title,
      run: !!document.getElementById('btn-run'),
      sfr: !!document.getElementById('sfr')
    }));
    ok(offline.title.includes('51') && offline.run && offline.sfr, '断网后页面仍能完整打开');
    await page.setOfflineMode(false);
  } finally {
    server.kill();
  }

  ok(errors.length === 0, '全程没有 JS 异常' + (errors.length ? '：' + errors.join(' | ') : ''));
  await browser.close();
  console.log(failed ? ('失败 ' + failed + ' 项') : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('验证失败:', e); process.exit(1); });
