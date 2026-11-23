/* 批次 3 真实浏览器验收：只读分享、条件/日志断点、实验报告导出。 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const base = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const downloadDir = path.resolve(__dirname, 'downloads');
const code = [
  '#include <REG51.H>',
  'void main(void) {',
  '  unsigned int i;',
  '  unsigned int count;',
  '  count = 0;',
  '  while (1) {',
  '    for (i = 0; i < 20; i = i + 1) {',
  '      count = count + 1;',
  '      P2 = count;',
  '    }',
  '  }',
  '}'
].join('\n');

function assert(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  if (!ok) process.exitCode = 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setCode(page, text) {
  await page.evaluate((t) => {
    const el = document.getElementById('code');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function consoleText(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.console') || document.getElementById('console');
    return c ? c.innerText : document.body.innerText;
  });
}
async function setCondBp(page, line, expr) {
  await page.evaluate((ln) => {
    const el = document.querySelector('#gutter [data-l="' + ln + '"]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  }, line);
  await page.waitForSelector('#dlg-input', { visible: true, timeout: 5000 });
  await page.evaluate((v) => { document.getElementById('dlg-input').value = v; }, expr);
  await page.click('#dlg-ok');
  await sleep(150);
}

(async () => {
  fs.mkdirSync(downloadDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  /* 1. 只读分享 */
  const ro = await browser.newPage();
  await ro.goto(base + '#ex=led-on&ro=1');
  await ro.waitForSelector('#code', { timeout: 15000 });
  await sleep(400);
  assert('只读模式：编辑器锁定', await ro.$eval('#code', (el) => el.readOnly === true));
  assert('只读模式：提示条出现', !!(await ro.$('.ro-bar')));
  assert('只读模式：格式化被禁用', await ro.$eval('#btn-format', (el) => el.disabled === true));
  await ro.evaluate(() => {
    const b = [...document.querySelectorAll('.ro-bar button')].find((x) => x.textContent.includes('复制为自己的工程'));
    b.click();
  });
  await sleep(200);
  assert('复制为自己：恢复可编辑', await ro.$eval('#code', (el) => el.readOnly === false));
  assert('复制为自己：提示条消失', !(await ro.$('.ro-bar')));
  assert('复制为自己：按钮恢复', await ro.$eval('#btn-format', (el) => el.disabled === false));
  await ro.close();

  /* 2. 条件断点 + 3. 日志断点 */
  const page = await browser.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.waitForSelector('#code', { timeout: 15000 });
  await setCode(page, code);
  await sleep(300);
  await setCondBp(page, 9, 'count == 10');
  await page.click('#btn-run');
  let hit = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const t = await consoleText(page);
    if (t.includes('条件断点命中') || t.includes('停在断点')) { hit = true; break; }
  }
  const bpList = await page.evaluate(() => (document.getElementById('bp-list') || {}).innerText || '');
  assert('条件断点：count == 10 时停下', hit, bpList.slice(0, 60));
  assert('断点列表显示条件', bpList.includes('count == 10'));
  await page.click('#btn-stop').catch(() => {});
  await sleep(200);

  await page.evaluate(() => {
    localStorage.removeItem('c51.bpconds');
    const el = document.querySelector('#gutter [data-l="9"]');
    if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await setCondBp(page, 8, 'log:count');
  await page.click('#btn-run');
  await sleep(2500);
  const logText = await consoleText(page);
  assert('日志断点：控制台打印变量', logText.includes('[日志断点]'));
  const stillRunning = await page.evaluate(() => !document.getElementById('btn-run') ||
    document.querySelector('#status') !== null);
  await page.click('#btn-stop').catch(() => {});
  await sleep(200);
  assert('日志断点：只打印不暂停（未出现断点命中）', !logText.includes('条件断点命中'), String(stillRunning));

  /* 4. 实验报告导出 */
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await page.click('#btn-report');
  await sleep(1200);
  const files = fs.readdirSync(downloadDir).filter((f) => f.endsWith('.md'));
  assert('实验报告：md 文件已下载', files.length > 0, files.join(','));
  if (files.length) {
    const content = fs.readFileSync(path.join(downloadDir, files[0]), 'utf-8');
    assert('报告包含代码章节', content.includes('## 一、实验代码') && content.includes('P2 = count;'));
    assert('报告包含诊断章节', content.includes('## 二、编译与诊断'));
    assert('报告包含运行观察', content.includes('## 三、运行观察'));
    assert('报告包含总结占位', content.includes('## 四、实验总结'));
  }
  await browser.close();
  console.log('批次3验收结束');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
