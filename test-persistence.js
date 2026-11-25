/* 回归测试：浏览器内工程（free）、分享工程归属、导出/快照的文件夹数据 */
const fs = require('fs');
const path = require('path');
const vmModule = require('vm');

class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.style = {};
    this.dataset = {}; this._text = ''; this._html = '';
    this.className = ''; this.scrollTop = 0; this.scrollHeight = 0;
    this.handlers = {}; this.parentNode = null; this.hidden = false;
    const self = this;
    const has = c => (' ' + self.className + ' ').indexOf(' ' + c + ' ') >= 0;
    this.classList = {
      contains: has,
      add: c => { if (!has(c)) self.className = (self.className ? self.className + ' ' : '') + c; },
      remove: c => { self.className = (' ' + self.className + ' ').replace(' ' + c + ' ', ' ').trim(); },
      toggle: (c, on) => { const want = on === undefined ? !has(c) : !!on; if (want) self.classList.add(c); else self.classList.remove(c); }
    };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parentNode = this; return c; }
  insertBefore(c, ref) {
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  focus() {}
  select() {}
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  set innerText(v) { this._text = String(v); }
  get innerText() { return this._text; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0]; }
  set value(v) { this._value = v; }
  get value() { return this._value === undefined ? '' : this._value; }
  get selectionStart() { return this._selS || 0; }
  get selectionEnd() { return this._selE || 0; }
  set selectionStart(v) { this._selS = v; }
  set selectionEnd(v) { this._selE = v; }
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function boot(options) {
  const registry = {};
  const store = Object.assign({}, options.store || {});
  const timers = [];
  let timerId = 1;
  const localStorageStub = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); }
  };
  const sandbox = {
    console,
    document: {
      body: new El('body'),
      getElementById: id => registry[id] || (registry[id] = new El('div')),
      createElement: t => new El(t),
      createElementNS: (ns, t) => new El(t),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    },
    requestAnimationFrame: () => 0,
    localStorage: localStorageStub,
    setTimeout: (fn, ms) => { const id = timerId++; timers.push({ id, fn }); return id; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    addEventListener: () => {},
    location: { hash: options.hash || '' },
    navigator: {},
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    TextDecoder: global.TextDecoder,
    unescape: global.unescape,
    escape: global.escape
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vmModule.createContext(sandbox);
  for (const f of ['vm.js', 'hw.js', 'examples.js', 'app.js']) {
    vmModule.runInContext(fs.readFileSync(path.join(__dirname, 'src', f), 'utf-8'), ctx, { filename: f });
  }
  const flushTimers = () => {
    let guard = 0;
    while (timers.length && guard++ < 100) {
      const pending = timers.splice(0, timers.length);
      pending.forEach(t => t.fn());
    }
  };
  return { registry, store, sandbox, flushTimers };
}

function freeProject() {
  return {
    format: 'c51lab-project', version: 1, name: '恢复工程',
    files: [{ path: 'main.c', content: 'void main(){ P2 = 0xFE; }' }],
    folders: ['src'], folderGroup: { src: 'Source Group 1' },
    groups: [{ name: 'Source Group 1', files: ['main.c'] }],
    open: ['main.c'], active: 'main.c'
  };
}

/* 1. 启动时恢复 free 工程，且编辑后会继续写回 free 键 */
{
  const saved = freeProject();
  const app = boot({ store: { 'c51lab.project.v1.free': JSON.stringify(saved) } });
  check('起始恢复 free 工程', app.registry.code.value === saved.files[0].content,
    'code=' + JSON.stringify(app.registry.code.value));
  check('恢复的是工程名',
    app.registry.console.children.map(c => c.textContent).join('|').indexOf('恢复工程') >= 0, true);

  app.registry.code.value = 'void main(){ P2 = 0xFF; }';
  const input = (app.registry.code.handlers.input || [])[0];
  if (input) input();
  app.flushTimers();
  const after = JSON.parse(app.store['c51lab.project.v1.free']);
  check('编辑自定义工程后自动写回 free', after.files[0].content === 'void main(){ P2 = 0xFF; }',
    JSON.stringify(after.files[0].content));
}

/* 2. 打开分享工程后，编辑只能写 free 键，不能覆盖被分享例程的存档 */
{
  const example = {
    format: 'c51lab-project', version: 1, name: 'LED 例程存档',
    files: [{ path: 'main.c', content: 'SAVED_EXAMPLE' }],
    folders: [], groups: [{ name: 'Source Group 1', files: ['main.c'] }],
    open: ['main.c'], active: 'main.c'
  };
  const shared = {
    format: 'c51lab-project', version: 1, name: '分享工程',
    files: [{ path: 'main.c', content: 'SHARED_CODE' }],
    folders: ['inc'], folderGroup: { inc: 'Source Group 1' },
    groups: [{ name: 'Source Group 1', files: ['main.c'] }],
    open: ['main.c'], active: 'main.c'
  };
  const p = Buffer.from(JSON.stringify(shared)).toString('base64url');
  const app = boot({
    store: { 'c51lab.project.v1.led-on': JSON.stringify(example) },
    hash: '#ex=led-on&p=' + p + '&ro=1'
  });
  check('分享工程覆盖启动例程', app.registry.code.value === 'SHARED_CODE',
    JSON.stringify(app.registry.code.value));

  app.registry.code.value = 'SHARED_EDITED';
  const input = (app.registry.code.handlers.input || [])[0];
  if (input) input();
  app.flushTimers();
  const exampleAfter = JSON.parse(app.store['c51lab.project.v1.led-on']);
  const freeAfter = JSON.parse(app.store['c51lab.project.v1.free'] || '{}');
  check('分享工程不覆盖例程存档', exampleAfter.files[0].content === 'SAVED_EXAMPLE',
    exampleAfter.files[0].content);
  check('分享工程编辑落到 free 键', freeAfter.files && freeAfter.files[0].content === 'SHARED_EDITED',
    JSON.stringify(freeAfter.files && freeAfter.files[0].content));
  check('分享工程的 folderGroup 被保留',
    freeAfter.folderGroup && freeAfter.folderGroup.inc === 'Source Group 1',
    JSON.stringify(freeAfter.folderGroup));
}

/* 3. 快照会带上空文件夹与 folderGroup */
{
  const app = boot({ store: { 'c51lab.project.v1.free': JSON.stringify(freeProject()) } });
  app.registry['snap-save'].onclick();
  const snap = JSON.parse(app.store['c51.snapshots'])[0];
  check('快照保留 folders', Array.isArray(snap.data.folders) && snap.data.folders.indexOf('src') >= 0,
    JSON.stringify(snap.data.folders));
  check('快照保留 folderGroup', snap.data.folderGroup && snap.data.folderGroup.src === 'Source Group 1',
    JSON.stringify(snap.data.folderGroup));
}

console.log('\n持久化回归：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
