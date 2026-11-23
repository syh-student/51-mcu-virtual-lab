const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const base = 'file://' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const out = path.resolve(__dirname, '..', '..', 'shots-a');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  async function shot(url, file, after) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('#code');
    await sleep(500);
    if (after) await after(page);
    await page.screenshot({ path: path.join(out, file) });
    await page.close();
  }

  await shot(base, 'a-code-dark.png');
  await shot(base + '#page=board', 'a-board-dark.png');
  await shot(base + '#page=scope', 'a-scope-dark.png', async (p) => {
    await p.click('#btn-run');
    await sleep(1600);
  });
  await shot(base, 'a-code-light.png', async (p) => {
    await p.click('#btn-theme');
    await sleep(300);
  });
  await shot(base + '#page=board', 'a-board-light.png');

  await browser.close();
  console.log('screenshots ->', out);
})().catch((e) => { console.error(e); process.exit(1); });
