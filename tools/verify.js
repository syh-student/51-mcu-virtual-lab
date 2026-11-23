/* 在真实浏览器里验证：F12 跳转到定义、新建文件夹、文件进文件夹 */
const puppeteer = require('puppeteer');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const url = pathToFileURL(path.join(ROOT, 'index.html')).href + '#ex=lcd';

let failed = 0;
const ok = (cond, msg) => { if (!cond) failed++; console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); };

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 800));

  /* 1. F12 跳转到定义（此时编辑器里是 LCD 例程） */
  const jump = await page.evaluate(() => {
    const el = document.getElementById('code');
    const src = el.value;
    const at = src.indexOf('LCD_WriteCommand(0x01)');
    el.focus();
    el.selectionStart = el.selectionEnd = Math.max(0, at) + 1;
    return { at: at, line: src.slice(0, Math.max(0, at)).split('\n').length };
  });
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 300));
  const jumpLog = await page.evaluate(() => document.getElementById('console').textContent);
  const jumpLine = /已跳到.*?第\s*(\d+)\s*行/.exec(jumpLog);
  console.log('    光标在：第 ' + jump.line + ' 行；日志：' + (/已跳到[^。]*。/.exec(jumpLog) || ['(没跳）'])[0]);
  ok(jumpLine && Number(jumpLine[1]) > 0 && Number(jumpLine[1]) !== jump.line, 'F12 跳转到了函数定义行（行号有效且不是当前行）');

  /* 2. 新建文件夹 src */
  await page.click('#btn-new-folder');
  await page.evaluate(() => { document.getElementById('dlg-input').value = 'src'; });
  await page.click('#dlg-ok');
  await new Promise(r => setTimeout(r, 300));
  ok(await page.evaluate(() => document.getElementById('proj-tree').textContent.includes('src/')), '工程树里出现文件夹 src/');

  /* 3. 在 src 里新建 led.c（路径里带目录） */
  await page.click('#btn-new-file');
  await page.evaluate(() => { document.getElementById('item-name').value = 'src/led.c'; });
  await page.click('#item-ok');
  await new Promise(r => setTimeout(r, 400));
  const nested = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#proj-tree .p-row')].map(r => ({
      text: r.nameEl ? r.nameEl.textContent : r.textContent.replace('×', '').trim(),
      pad: parseInt(r.style.paddingLeft, 10)
    }));
    const dir = rows.find(r => r.text === 'src/');
    const file = rows.find(r => r.text === 'led.c');
    return { hasDir: !!dir, hasFile: !!file, dirPad: dir && dir.pad, filePad: file && file.pad };
  });
  ok(nested.hasDir && nested.hasFile, '文件夹和文件都在树上');
  ok(nested.hasFile && nested.filePad > nested.dirPad, '文件缩进在文件夹里面（' + nested.filePad + ' > ' + nested.dirPad + '）');

  await browser.close();
  console.log(failed ? ('失败 ' + failed + ' 项') : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('验证失败:', e); process.exit(1); });
