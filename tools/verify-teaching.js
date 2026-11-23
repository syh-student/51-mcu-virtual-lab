/* 真实浏览器验证批次 1：SFR 面板、手动 Watch、诊断建议、静态提醒 */
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const url = pathToFileURL(path.join(ROOT, 'index.html')).href;

let failed = 0;
const ok = (cond, msg) => { if (!cond) failed++; console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function setCode(page, src) {
  await page.evaluate((s) => {
    const el = document.getElementById('code');
    el.focus();
    el.value = s;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, src);
  await sleep(200);
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load' });
  await sleep(800);

  const sfrInit = await page.evaluate(() => document.getElementById('sfr').textContent);
  console.log('    SFR 初始内容：' + (sfrInit || '(空)').slice(0, 60));
  ok(sfrInit.includes('运行后显示') || sfrInit.includes('TMOD'), 'SFR 面板初始有空态提示或寄存器值');

  /* 1. 跑一段配置定时器的程序，看 SFR 面板 */
  await setCode(page, 'void main(void) {\n  TMOD = 0x01;\n  TH0 = 0xFC;\n  TL0 = 0x18;\n  EA = 1;\n  ET0 = 1;\n  TR0 = 1;\n  while (1) { }\n}\n');
  await page.click('#btn-run');
  await sleep(1200);
  const sfr = await page.evaluate(() => ({
    text: document.getElementById('sfr').textContent,
    bits: document.querySelectorAll('#sfr .sfr-bit').length,
    ones: document.querySelectorAll('#sfr .sfr-bit.one').length,
    title: (document.querySelector('#sfr .sfr-bit') || {}).title || ''
  }));
  console.log('    SFR 文本片段：' + sfr.text.slice(0, 120).replace(/\s+/g, ' '));
  ok(sfr.text.includes('TMOD') && sfr.text.includes('TCON') && sfr.text.includes('PSW'), 'SFR 面板列出关键寄存器');
  ok(sfr.bits === 48, '每个寄存器 8 个位块，共 48 个（实际 ' + sfr.bits + '）');
  ok(sfr.ones > 0, '有置位的位块高亮（' + sfr.ones + ' 个）');
  ok(sfr.title.includes('TMOD.7'), '位块悬停显示位含义（' + sfr.title + '）');
  ok(/T0 = 0x[0-9A-F]+/.test(sfr.text) && sfr.text.includes('方式 1'), '定时器行显示计数值和工作方式');
  ok(sfr.text.includes('运行中'), 'TR0 = 1 时定时器显示运行中');

  /* 2. 手动 Watch */
  await page.evaluate(() => {
    const i = document.getElementById('watch-input');
    i.value = 'TH0';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const w1 = await page.evaluate(() => document.getElementById('watch').textContent);
  ok(w1.includes('TH0'), '手动加入的 TH0 出现在监视里');
  await page.evaluate(() => {
    const i = document.getElementById('watch-input');
    i.value = 'not_a_var';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const w2 = await page.evaluate(() => document.getElementById('watch').textContent);
  ok(w2.includes('not_a_var') && w2.includes('未定义'), '不存在的变量显示「未定义」而不是报错');
  const stored = await page.evaluate(() => localStorage.getItem('c51.watch'));
  ok((stored || '').includes('TH0'), 'Watch 列表写进了 localStorage（' + stored + '）');
  await page.evaluate(() => {
    const b = document.querySelector('[data-watch-del="not_a_var"]');
    if (b) b.click();
  });
  await sleep(300);
  ok(!(await page.evaluate(() => document.getElementById('watch').textContent)).includes('not_a_var'), '点 × 能移除监视项');

  /* 3. 运行错误给建议（未定义变量在运行期才报） */
  const stop = await page.$('#btn-stop');
  if (stop) { await stop.click(); await sleep(200); }
  await setCode(page, 'void main(void) {\n  TMO = 1;\n  while (1) { }\n}\n');
  await page.click('#btn-run');
  await sleep(800);
  const prob = await page.evaluate(() => document.getElementById('build-problems').textContent);
  const runLog = await page.evaluate(() => document.getElementById('build-log').textContent);
  ok(prob.includes('建议：') || runLog.includes('建议：'), '报错带「建议：」（问题列表或输出区）');
  ok((prob + runLog).includes('TMOD'), 'TMO 写错时给出「你是不是想写 TMOD」（实际：' + ((prob + runLog).match(/建议：[^。]*。/) || ['无'])[0] + '）');
  ok(prob.includes('没有定义'), '运行期错误也进入了问题列表');
  if (stop) { await stop.click(); await sleep(200); }

  /* 4. 静态提醒 */
  await setCode(page, 'void main(void) {\n  TR0 = 1;\n  while (1) { }\n}\n');
  await page.click('#btn-build');
  await sleep(500);
  const log = await page.evaluate(() => document.getElementById('build-log').textContent);
  ok(log.includes('hint:') && log.includes('TMOD'), '没配 TMOD 就启动定时器时给出静态提醒');

  /* 5. 正常例程不应被静态提醒误报 */
  await setCode(page, 'void main(void) {\n  TMOD = 0x01;\n  TR0 = 1;\n  while (1) { P1 = 0; }\n}\n');
  await page.click('#btn-build');
  await sleep(500);
  const log2 = await page.evaluate(() => document.getElementById('build-log').textContent);
  ok(!log2.includes('hint:'), '配置正确的代码不触发静态提醒');

  ok(errors.length === 0, '全程没有 JS 异常' + (errors.length ? '：' + errors.join(' | ') : ''));

  await browser.close();
  console.log(failed ? ('失败 ' + failed + ' 项') : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('验证失败:', e); process.exit(1); });
