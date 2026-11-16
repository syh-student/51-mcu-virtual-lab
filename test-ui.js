/* 用极简 DOM 桩跑一遍界面代码，捕获初始化/渲染/交互中的低级错误 */
const fs = require('fs');
const path = require('path');
const vmModule = require('vm');

class El {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.style = {};
    this.dataset = {}; this._text = ''; this._html = '';
    this.className = ''; this.scrollTop = 0; this.scrollHeight = 0;
    this.handlers = {};
    this.parentNode = null;
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
  addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
  querySelectorAll() { return []; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
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

const ids = ['status', 'btn-run', 'btn-step', 'btn-reset', 'speed', 'speed-val',
  'ex-list', 'gutter', 'code', 'cur-line', 'vtime', 'steps', 'ex-chapter', 'ex-goal',
  'ex-points', 'ex-quiz', 'quiz-wrap', 'board', 'btn-sound', 'ports', 'console', 'btn-clear'];
const registry = {};
ids.forEach(id => { registry[id] = new El('div'); registry[id].id = id; });
registry.speed.value = '1';

const rafQueue = [];
const sandbox = {
  console,
  document: {
    body: new El('body'),
    getElementById: id => registry[id] || (registry[id] = new El('div')),
    createElement: t => new El(t),
    createElementNS: (ns, t) => new El(t),
    querySelectorAll: () => []
  },
  requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener: () => {},
  location: { hash: '' }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

const ctx = vmModule.createContext(sandbox);
for (const f of ['vm.js', 'hw.js', 'examples.js', 'app.js']) {
  const code = fs.readFileSync(path.join(__dirname, 'src', f), 'utf-8');
  try {
    vmModule.runInContext(code, ctx, { filename: f });
    console.log('加载成功  ' + f);
  } catch (e) {
    console.log('FAIL  ' + f + '  ' + e.stack);
    process.exit(1);
  }
}

/* 手动推进若干帧 */
try {
  let t = 0;
  for (let i = 0; i < 30; i++) {
    const cbs = rafQueue.splice(0, rafQueue.length);
    if (!cbs.length) break;
    t += 16;
    cbs.forEach(fn => fn(t));
  }
  console.log('初始渲染 30 帧无异常');

  /* 模拟点击运行 */
  registry['btn-run'].onclick();
  for (let i = 0; i < 60; i++) {
    const cbs = rafQueue.splice(0, rafQueue.length);
    if (!cbs.length) break;
    t += 16;
    cbs.forEach(fn => fn(t));
  }
  console.log('运行 60 帧无异常  状态=' + registry.status.textContent +
    '  虚拟时间=' + registry.vtime.textContent + '  端口P2=' + registry['cur-line'].textContent);
  console.log('控制台条数=' + registry.console.children.length);
  const errs = registry.console.children.filter(c => c.className === 'err');
  if (errs.length) { console.log('FAIL 控制台有错误: ' + errs.map(e => e.textContent).join(' | ')); process.exit(1); }

  /* 串口发送：运行中往板子发两个字节 */
  registry['serial-tx'].value = 'AB';
  registry['btn-serial-send'].onclick();
  const serLog = registry.console.children.map(c => c.textContent).join('|');
  if (serLog.indexOf('已向板子发送 2 个字节') < 0) {
    console.log('FAIL 串口发送没有成功提示：' + serLog); process.exit(1);
  }
  if (registry['serial-tx'].value !== '') { console.log('FAIL 发送后输入框未清空'); process.exit(1); }
  console.log('串口发送 OK（2 字节进队列，输入框已清空）');

  /* 单步 / 复位 */
  registry['btn-step'].onclick();
  registry['btn-reset'].onclick();
  for (let i = 0; i < 5; i++) {
    const cbs = rafQueue.splice(0, rafQueue.length);
    t += 16; cbs.forEach(fn => fn(t));
  }
  console.log('单步与复位无异常');

  /* 放大看板：第一下跳页，第二下全屏，第三下退出 */
  const card = registry['board-card'], zoom = registry['btn-zoom'];
  const onBoard = () => registry['page-board'].className.indexOf('active') >= 0;
  zoom.onclick();
  console.log('放大看板第 1 下 → 页面=' + (onBoard() ? '开发板' : '写代码')
    + ' 卡片挂在=' + (card.parentNode === registry['slot-board-main'] ? '开发板槽' : '其他')
    + ' 按钮文案=' + zoom.textContent);
  if (!onBoard() || card.parentNode !== registry['slot-board-main']) {
    console.log('FAIL 第一次点击没有跳到开发板页'); process.exit(1);
  }
  zoom.onclick();
  console.log('放大看板第 2 下 → 全屏=' + card.classList.contains('board-full')
    + ' 按钮文案=' + zoom.textContent);
  if (!card.classList.contains('board-full')) { console.log('FAIL 第二次点击没有全屏'); process.exit(1); }
  if (!sandbox.document.body.classList.contains('zoomed')) { console.log('FAIL 全屏时没有隐藏页头'); process.exit(1); }
  zoom.onclick();
  if (card.classList.contains('board-full')) { console.log('FAIL 第三次点击没有退出全屏'); process.exit(1); }
  if (sandbox.document.body.classList.contains('zoomed')) { console.log('FAIL 退出后页头没有恢复'); process.exit(1); }
  console.log('放大看板第 3 下 → 已退出全屏，页头已恢复，按钮文案=' + zoom.textContent);
  if (zoom.textContent !== '全屏看板') { console.log('FAIL 退出后按钮文案不对'); process.exit(1); }

  /* 编辑器按键：自动缩进 / 配对 / 块缩进 */
  const code = registry['code'];
  const kd = (code.handlers.keydown || [])[0];
  if (!kd) { console.log('FAIL code 元素没有 keydown 处理器'); process.exit(1); }
  const key = (k, opt) => {
    const ev = Object.assign({ key: k, preventDefault() {} }, opt || {});
    kd.call(code, ev);
    return ev;
  };
  const setCode = (text, s, e) => {
    code.value = text; code.selectionStart = s; code.selectionEnd = (e == null ? s : e);
  };
  let pass = 0, fail = 0;
  const expect = (name, actual, want) => {
    const ok = JSON.stringify(actual) === JSON.stringify(want);
    if (ok) { pass++; console.log('编辑器√ ' + name); }
    else { fail++; console.log('编辑器× ' + name + '  得到=' + JSON.stringify(actual) + '  期望=' + JSON.stringify(want)); }
  };

  /* 回车：在 { 和 } 之间 → 三行，光标在中间行 */
  setCode('void f()\n{}', 10);
  key('Enter');
  expect('花括号间回车', [code.value, code.selectionStart], ['void f()\n{\n\t\n}', 12]);

  /* 回车：行尾是 { → 多缩进一级 */
  setCode('void f()\n{', 10);
  key('Enter');
  expect('左花括号后回车', [code.value, code.selectionStart], ['void f()\n{\n\t', 12]);

  /* 回车：普通行 → 继承缩进 */
  setCode('void f()\n{\n\tP2 = 0xFE;', 22);
  key('Enter');
  expect('普通行回车继承缩进', code.value, 'void f()\n{\n\tP2 = 0xFE;\n\t');

  /* 输入 } 电致回退 */
  setCode('void f()\n{\n\t', 12);
  key('}');
  expect('右花括号电致回退', code.value, 'void f()\n{\n}');

  /* 自动配对 ( */
  setCode('P2 = 0x', 7);
  key('(');
  expect('自动配对小括号', [code.value, code.selectionStart], ['P2 = 0x()', 8]);

  /* 有选中时包围 */
  setCode('P2 = 0xFE', 5, 9);
  key('(');
  expect('选中文本包围', code.value, 'P2 = (0xFE)');

  /* 覆盖输入：光标后是 ) 直接跳过 */
  setCode('P2 = 0xFE()', 10);
  key(')');
  expect('覆盖输入右括号', [code.value, code.selectionStart], ['P2 = 0xFE()', 11]);

  /* 退格删除空配对 */
  setCode('P2 = ()', 6);
  key('Backspace');
  expect('退格删空配对', code.value, 'P2 = ');

  /* 单行 Tab / Shift+Tab */
  setCode('P2 = 0xFE;', 0);
  key('Tab');
  expect('行首 Tab', code.value, '\tP2 = 0xFE;');
  key('Tab', { shiftKey: true });
  expect('行首 Shift+Tab', code.value, 'P2 = 0xFE;');

  /* 多行块缩进 / 反缩进 */
  setCode('a = 1;\nb = 2;', 0, 12);
  key('Tab');
  expect('多行 Tab 块缩进', code.value, '\ta = 1;\n\tb = 2;');
  setCode(code.value, 0, code.value.length);
  key('Tab', { shiftKey: true });
  expect('多行 Shift+Tab 反缩进', code.value, 'a = 1;\nb = 2;');

  /* 回车：{ 后的空行上回车 → 只继承缩进，不再多缩一级（对齐 bug 回归） */
  setCode('void main()\n{\n\t', 15);
  key('Enter');
  expect('花括号内空行回车不加深', code.value, 'void main()\n{\n\t\n\t');

  /* 嵌套 while 块：闭括号必须与 while 对齐 */
  setCode('void main()\n{\n\twhile(1)\n\t{\n\t\tP2 = 0xFE;\n\t\t', 42);
  key('Enter');
  key('}');
  expect('闭括号与 while 对齐', code.value,
    'void main()\n{\n\twhile(1)\n\t{\n\t\tP2 = 0xFE;\n\t\t\n\t}');

  /* if 行回车 → 多缩一级（无括号单语句体） */
  setCode('void f()\n{\n\tif (a)', 18);
  key('Enter');
  expect('if 后回车多缩一级', code.value, 'void f()\n{\n\tif (a)\n\t\t');

  /* if 后回车再打 { → 自动退回与 if 同级，再回车 → Allman 三行 */
  setCode('void f()\n{\n\tif (a)\n\t\t', 22);
  key('{');
  expect('悬空行打花括号回到 if 同级', code.value, 'void f()\n{\n\tif (a)\n\t{}');
  key('Enter');
  expect('if 的 Allman 三行', code.value, 'void f()\n{\n\tif (a)\n\t{\n\t\t\n\t}');

  /* 无括号 if 体之后打 } → 直接对齐外层块（不是只退一级） */
  setCode('void f()\n{\n\tif (a)\n\t\tP2 = 1;\n\t\t', 31);
  key('}');
  expect('无括号 if 体后闭括号对齐外层', code.value,
    'void f()\n{\n\tif (a)\n\t\tP2 = 1;\n}');

  /* case 行回车 → 多缩一级 */
  setCode('void f()\n{\n\tswitch (k)\n\t{\n\tcase 1:', 35);
  key('Enter');
  expect('case 后回车多缩一级', code.value,
    'void f()\n{\n\tswitch (k)\n\t{\n\tcase 1:\n\t\t');

  /* else 链路：} 电致回退 → 回车 → else → 回车 → { 退回同级 */
  setCode('void f()\n{\n\tif (a)\n\t\tP2 = 1;\n\t\t', 31);
  key('}');
  key('Enter');
  setCode(code.value + 'else', code.value.length + 4);
  key('Enter');
  expect('else 后回车多缩一级', code.value,
    'void f()\n{\n\tif (a)\n\t\tP2 = 1;\n}\nelse\n\t');
  key('{');
  expect('else 的花括号回到同级', code.value,
    'void f()\n{\n\tif (a)\n\t\tP2 = 1;\n}\nelse\n{}');

  /* while 新链路：回车多缩一级 → 打 { 自动退回 → 回车三行对齐 */
  setCode('void f()\n{\n\twhile(1)', 21);
  key('Enter');
  expect('while 后回车多缩一级', code.value, 'void f()\n{\n\twhile(1)\n\t\t');
  key('{');
  expect('悬空行打花括号回到 while 同级', code.value, 'void f()\n{\n\twhile(1)\n\t{}');
  key('Enter');
  expect('while 的 Allman 三行', code.value, 'void f()\n{\n\twhile(1)\n\t{\n\t\t\n\t}');

  /* Ctrl+/ 注释切换：选中三行 → 加注释，再切一次 → 还原 */
  setCode('a = 1;\n\tb = 2;\nc = 3;', 0, 17);
  key('/', { ctrlKey: true });
  expect('Ctrl+/ 整体加注释', code.value, '// a = 1;\n\t// b = 2;\n// c = 3;');
  setCode(code.value, 0, code.value.length);
  key('/', { ctrlKey: true });
  expect('Ctrl+/ 再按还原', code.value, 'a = 1;\n\tb = 2;\nc = 3;');

  console.log('编辑器按键断言：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exit(1);

  /* 工程树：Project → Target → Source Group → 文件 */
  const rows = () => registry['proj-tree'].children.map(r => {
    const nm = r.children.filter(c => c.className === 'nm')[0];
    return nm ? nm.textContent : '';
  });
  let labels = rows();
  console.log('工程树 = ' + labels.join(' / '));
  expect('工程树第一层是 Project', /^Project:/.test(labels[0] || ''), true);
  expect('工程树有 Target 1', labels.indexOf('Target 1') >= 0, true);
  expect('工程树有 Source Group 1', labels.indexOf('Source Group 1') >= 0, true);

  /* 新建分组 */
  registry['btn-new-group'].onclick();
  labels = rows();
  expect('新建分组后出现第二组',
    labels.filter(x => /^Source Group/.test(x)).length, 2);

  /* 新建文件对话框 */
  registry['btn-new-file'].onclick();
  expect('新建对话框已打开',
    registry['dlg-new'].className.indexOf('on') >= 0, true);
  expect('默认类型是 C 源文件', registry['item-type-name'].value, 'C 源文件（.c）');
  expect('默认文件名是 new.c', registry['item-name'].value, 'new.c');

  registry['item-name'].value = 'led.c';
  registry['item-ok'].onclick();
  labels = rows();
  expect('新建后树里出现 led.c', labels.indexOf('led.c') >= 0, true);
  expect('新建后对话框关闭',
    registry['dlg-new'].className.indexOf('on') < 0, true);

  console.log('\n界面冒烟测试通过');
} catch (e) {
  console.log('FAIL  渲染过程异常: ' + e.stack);
  process.exit(1);
}
