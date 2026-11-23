/* 界面与渲染：把 VM / 硬件模型接到页面上 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var $ = function (id) { return document.getElementById(id); };

  var codeEl = $('code'), gutter = $('gutter'), consoleEl = $('console');
  var vm = null, hw = null, state = 'stopped', speed = 1, curExample = null;
  var ledEls = [], ledHalo = [], segEls = [], dpEls = [], lcdLines = [], keyEls = {}, buzzerEl = null, buzzerText = null;
  var portBits = {}, portHex = {};
  var lastGutterLine = -1;

  /* ---------------- 控制台 ---------------- */
  function log(msg, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    consoleEl.appendChild(d);
    consoleEl.scrollTop = consoleEl.scrollHeight;
    while (consoleEl.childNodes.length > 200) consoleEl.removeChild(consoleEl.firstChild);
  }

  /* ---------------- 画开发板 ---------------- */
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function svgText(parent, x, y, str, attrs) {
    var a = { x: x, y: y, 'font-size': 11, fill: '#5a6a5f', 'font-family': 'inherit' };
    for (var k in (attrs || {})) a[k] = attrs[k];
    var t = svgEl('text', a, parent);
    t.textContent = str;
    return t;
  }

  var SEG_SHAPE = {
    a: '9,5 25,5 28,8 25,11 9,11 6,8',
    g: '9,27 25,27 28,30 25,33 9,33 6,30',
    d: '9,49 25,49 28,52 25,55 9,55 6,52',
    f: '8,8 11,11 11,27 8,30 5,27 5,11',
    b: '26,8 29,11 29,27 26,30 23,27 23,11',
    e: '8,32 11,35 11,51 8,54 5,51 5,35',
    c: '26,32 29,35 29,51 26,54 23,51 23,35'
  };
  var SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  var SILK = '#eaf2fb';
  function silk(parent, x, y, str, size, anchor, extra) {
    var a = {
      'font-size': size || 7, fill: SILK, 'text-anchor': anchor || 'start',
      'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif', opacity: .95
    };
    for (var k in (extra || {})) a[k] = extra[k];
    return svgText(parent, x, y, str, a);
  }
  function box(p, x, y, w, h, r, fill, stroke, sw) {
    var a = { x: x, y: y, width: w, height: h, rx: r == null ? 2 : r, fill: fill };
    if (stroke) { a.stroke = stroke; a['stroke-width'] = sw || 1; }
    return svgEl('rect', a, p);
  }
  function circ(p, cx, cy, r, fill, stroke, sw) {
    var a = { cx: cx, cy: cy, r: r, fill: fill };
    if (stroke) { a.stroke = stroke; a['stroke-width'] = sw || 1; }
    return svgEl('circle', a, p);
  }
  /* 黄色排针（母座）：开发板上最显眼的特征之一 */
  function yellowHeader(p, x, y, n, pitch, vertical) {
    if (vertical) {
      box(p, x, y, 12, n * pitch + 2, 1.5, '#e2c235', '#a98d19', .7);
      for (var i = 0; i < n; i++) box(p, x + 3, y + 2 + i * pitch, 6, 4, .8, '#3a2f08');
    } else {
      box(p, x, y, n * pitch + 2, 12, 1.5, '#e2c235', '#a98d19', .7);
      for (var j = 0; j < n; j++) box(p, x + 2 + j * pitch, y + 3, 4, 6, .8, '#3a2f08');
    }
  }
  /* 黑色排针（母座） */
  function blackHeader(p, x, y, cols, rows, pitch) {
    box(p, x, y, cols * pitch + 3, rows * pitch + 3, 1, '#131619');
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        box(p, x + 2 + c * pitch, y + 2 + r * pitch, pitch - 2, pitch - 2, .6, '#2b3036');
      }
    }
  }

  /* ---------------- 板面悬停说明 ---------------- */
  var tipEl = $('board-tip');
  var floatEl = $('board-float');
  var TIP_IDLE = '把鼠标移到板上的元件上，这里会写出它的名称、接的引脚，以及在仿真里能不能用。';
  function setTip(t) {
    if (tipEl) {
      tipEl.textContent = t || TIP_IDLE;
      if (tipEl.classList) tipEl.classList.toggle('on', !!t);
    }
    /* 同步给跟随鼠标的浮层：说明直接出现在手边，不用低头找底部那行字 */
    if (floatEl) {
      floatEl.textContent = t || '';
      floatEl.hidden = !t;
    }
  }
  /* 浮层跟着指针走，靠近右 / 下边缘时自动翻面，避免被裁掉 */
  function moveFloat(x, y) {
    if (!floatEl || floatEl.hidden || !floatEl.style) return;
    var w = floatEl.offsetWidth || 260, h = floatEl.offsetHeight || 70;
    var vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
    var vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
    var left = x + 18, top = y + 20;
    if (left + w > vw - 12) left = Math.max(12, x - w - 18);
    if (top + h > vh - 12) top = Math.max(12, y - h - 20);
    floatEl.style.left = left + 'px';
    floatEl.style.top = top + 'px';
  }
  (function () {
    var stage = $('board-wrap');
    if (!stage || !stage.addEventListener) return;
    stage.addEventListener('pointermove', function (e) {
      if (e) moveFloat(e.clientX || 0, e.clientY || 0);
    });
    stage.addEventListener('pointerleave', function () { if (floatEl) floatEl.hidden = true; });
  })();
  var hotRegions = [];
  function hot(x, y, w, h, tip) { hotRegions.push([x, y, w, h, tip]); }


  /* ---------------- 四角取景框：跟着鼠标下的元件走 ---------------- */
  var reticleEl = $('reticle'), reticleLabelEl = $('reticle-label');
  var lastHot = null;
  function svgNodeOf(host) {
    if (!host) return null;
    if (host.querySelector) {
      var sv = host.querySelector('svg');
      if (sv) return sv;
    }
    for (var i = 0; host.childNodes && i < host.childNodes.length; i++) {
      if (String(host.childNodes[i].tag) === 'svg') return host.childNodes[i];
    }
    return null;
  }
  function showReticle(rg) {
    lastHot = rg;
    var stage = $('board-wrap'), host = $('board');
    if (!reticleEl || !stage || !host) return;
    if (!stage.getBoundingClientRect || !host.getBoundingClientRect) return;
    var svg = svgNodeOf(host);
    if (!svg || !svg.getBoundingClientRect) return;
    var s = svg.getBoundingClientRect(), w = stage.getBoundingClientRect();
    if (!s.width || !s.height) return;
    /* SVG 默认按 xMidYMid meet 等比缩放：板子（656×722）放进一个宽扁的舞台时，
       上下左右会留黑边。取景框必须按「实际内容区」算，不能直接拿元素宽度当比例，
       否则框会比元件大一圈、还整体偏左上。 */
    var VB_W = 656, VB_H = 722, PAD = 9;
    var k = Math.min(s.width / VB_W, s.height / VB_H);
    var ox = (s.width - VB_W * k) / 2, oy = (s.height - VB_H * k) / 2;
    var left = (s.left - w.left) + ox + rg[0] * k - PAD;
    var top = (s.top - w.top) + oy + rg[1] * k - PAD;
    reticleEl.style.left = left + 'px';
    reticleEl.style.top = top + 'px';
    reticleEl.style.width = (rg[2] * k + PAD * 2) + 'px';
    reticleEl.style.height = (rg[3] * k + PAD * 2) + 'px';
    if (reticleEl.classList) reticleEl.classList.toggle('below', top < 32);
    if (reticleLabelEl) reticleLabelEl.textContent = String(rg[4] || '').split('：')[0];
    if (reticleEl.classList) reticleEl.classList.add('ready');
  }
  function hideReticle() {
    lastHot = null;
    if (reticleEl && reticleEl.classList) reticleEl.classList.remove('ready');
  }
  /* 触屏没有真正的 mouseleave：点完元件后取景框和说明会一直留着，
     几秒后自动收起，免得挡住板子。 */
  (function () {
    var host = $('board');
    if (!host || !host.addEventListener) return;
    var timer = 0;
    host.addEventListener('pointerdown', function (e) {
      if (!e || e.pointerType !== 'touch') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = 0; hideReticle(); setTip(''); }, 5000);
    });
  })();
  window.addEventListener('resize', function () { if (lastHot) showReticle(lastHot); syncTipPos(); });

  /* 开发板页把说明条浮到板面左上（那块是空的）。浮层锚在整张卡片上，
     所以用标题栏实际高度把它推到板面区域里去。 */
  function syncTipPos() {
    if (!tipEl || !tipEl.style) return;
    if (curPage !== 'board') { tipEl.style.top = ''; return; }
    var head = null, card = $('board-card');
    if (card && card.querySelector) head = card.querySelector('.panel-h');
    var hh = head && head.offsetHeight ? head.offsetHeight : 42;
    tipEl.style.top = (hh + 10) + 'px';
  }

  function buildBoard() {
    var host = $('board');
    host.innerHTML = '';
    var svg = svgEl('svg', { viewBox: '0 0 656 722', role: 'img' }, host);

    var defs = svgEl('defs', {}, svg);
    var pcb = svgEl('linearGradient', { id: 'pcbG', x1: '0', y1: '0', x2: '.7', y2: '1' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#20559c' }, pcb);
    svgEl('stop', { offset: '.5', 'stop-color': '#1a4788' }, pcb);
    svgEl('stop', { offset: '1', 'stop-color': '#153a72' }, pcb);
    var gold = svgEl('linearGradient', { id: 'goldG', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#f2da98' }, gold);
    svgEl('stop', { offset: '1', 'stop-color': '#a8842e' }, gold);
    var lcdg = svgEl('linearGradient', { id: 'lcdG', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    svgEl('stop', { offset: '0', 'stop-color': '#cbe0b0' }, lcdg);
    svgEl('stop', { offset: '1', 'stop-color': '#a9c68d' }, lcdg);

    hotRegions = [];

    /* ============ 液晶屏模块（插在板上，立起来） ============ */
    box(svg, 300, 14, 340, 92, 4, '#0c4f37', '#073526');
    /* 四角安装孔 + 内屏顶部内阴影，让它看起来是有厚度的模块 */
    [[311, 25], [629, 25], [311, 95], [629, 95]].forEach(function (hh) {
      circ(svg, hh[0], hh[1], 3.4, '#062a1d');
      circ(svg, hh[0], hh[1], 1.7, '#0f5a3f');
    });
    box(svg, 320, 30, 300, 60, 2, 'url(#lcdG)', '#7d9560');
    box(svg, 320, 30, 300, 7, 2, 'rgba(20,40,24,.14)');
    lcdLines = [];
    for (var r = 0; r < 2; r++) {
      lcdLines.push(svgText(svg, 330, 56 + r * 27, '', {
        'font-family': 'Consolas, monospace', 'font-size': 19, fill: '#22392a', 'letter-spacing': .5
      }));
    }
    silk(svg, 618, 99, '1602', 6, 'end', { fill: '#8fd3b0' });
    hot(296, 10, 348, 100, '1602 液晶屏：RS 接 P2.6、RW 接 P2.5、E 接 P2.7，数据线走 P0。先写指令再写数据，屏幕上就会出现字符。');

    /* ============ 板体 ============ */
    box(svg, 8, 104, 640, 596, 10, 'url(#pcbG)', '#0b2c55', 1.2);
    var innerB = box(svg, 15, 111, 626, 582, 7, 'none', '#7ba8db', .7);
    innerB.setAttribute('opacity', .3);
    [[26, 122], [630, 122], [26, 682], [630, 682]].forEach(function (pt) {
      circ(svg, pt[0], pt[1], 6, '#12335c', '#c9a95c', 1.1);
      circ(svg, pt[0], pt[1], 3, '#0a1e36');
    });

    /* ============ 板面走线与过孔：让空白的蓝色区域不至于太假 ============ */
    var traceG = svgEl('g', { opacity: '.16' }, svg);
    [
      'M612 152 V332', 'M620 160 V330',
      'M386 334 V466', 'M392 340 V460'
    ].forEach(function (d) {
      var p = svgEl('path', { d: d, fill: 'none', stroke: '#9fc4ea', 'stroke-width': 1.1 }, traceG);
      p.setAttribute('stroke-linecap', 'round');
    });
    /* 过孔 */
    [[300, 206], [326, 212], [612, 200], [620, 300], [604, 340],
     [386, 340], [392, 420], [386, 500], [60, 616], [120, 620],
     [486, 612], [560, 600], [236, 470], [240, 440], [226, 510],
     [300, 600], [470, 600], [600, 470], [628, 400], [628, 560],
     [20, 340], [20, 480], [20, 600], [370, 220], [232, 262],
     [640, 340], [640, 240]
    ].forEach(function (v) {
      circ(svg, v[0], v[1], 2.3, '#12335c', '#9fc4ea', .7);
      circ(svg, v[0], v[1], 1, '#0a1e36');
    });

    /* ============ 8 位数码管：两个四位一体 ============ */
    segEls = []; dpEls = [];
    [[24, 0], [200, 4]].forEach(function (grp) {
      var gx = grp[0];
      box(svg, gx, 116, 164, 78, 3, '#3a3b33', '#1c1d18');
      box(svg, gx + 5, 120, 154, 70, 2, '#26271f');
      for (var i = 0; i < 4; i++) {
        var idx = grp[1] + i;
        var dx = gx + 9 + i * 38;
        var dg = svgEl('g', { transform: 'translate(' + dx + ',122)' }, svg);
        var segs = {};
        SEG_ORDER.forEach(function (s) {
          segs[s] = svgEl('polygon', { points: SEG_SHAPE[s], fill: '#5c6057' }, dg);
        });
        segEls.push(segs);
        dpEls.push(circ(dg, 31, 53, 2.6, '#a9ac9f'));
        silk(svg, dx + 13, 208, String(idx + 1), 6, 'middle', { fill: '#b7cfec' });
      }
    });
    silk(svg, 24, 226, '8 位数码管 · 段选 P0 · 位选 P2.2~P2.4', 6.5);
    hot(20, 112, 348, 90, '8 位数码管：段选接 P0，位选由 P2.2~P2.4 经 74HC138 译码。任何一位亮着，都说明程序正在不停扫描它（视觉暂留）。');

    /* 排阻 / 驱动芯片 / 滤波电容 */
    var rp;
    for (rp = 0; rp < 2; rp++) {
      box(svg, 30, 242 + rp * 18, 104, 13, 1, '#d8c9a1', '#a3926a', .6);
      for (var rd = 0; rd < 7; rd++) circ(svg, 40 + rd * 14, 248.5 + rp * 18, 1.6, '#5f5236');
    }
    silk(svg, 30, 238, '排阻', 5.5, 'start', { fill: '#c6dcf5' });
    box(svg, 150, 242, 30, 15, 1.2, '#1a1d22');
    for (var p1 = 0; p1 < 4; p1++) {
      box(svg, 152 + p1 * 7, 238, 3.5, 4, .4, '#b9c0c7');
      box(svg, 152 + p1 * 7, 257, 3.5, 4, .4, '#b9c0c7');
    }
    silk(svg, 184, 253, '段驱动', 5.5, 'start', { fill: '#c6dcf5' });
    box(svg, 150, 264, 30, 15, 1.2, '#1a1d22');
    for (var p2 = 0; p2 < 4; p2++) {
      box(svg, 152 + p2 * 7, 260, 3.5, 4, .4, '#b9c0c7');
      box(svg, 152 + p2 * 7, 279, 3.5, 4, .4, '#b9c0c7');
    }
    silk(svg, 184, 275, '位选译码', 5.5, 'start', { fill: '#c6dcf5' });
    circ(svg, 206, 292, 8, '#9aa3a8', '#6d777d', 1);
    circ(svg, 206, 292, 5.6, '#cfd6da');
    silk(svg, 218, 295, '电容', 5.5, 'start', { fill: '#c6dcf5' });
    hot(26, 238, 202, 58, '排阻与驱动芯片：74HC245 给段选信号做缓冲，74HC138 把 P2.2~P2.4 译成 8 根位选线。');

    /* ============ 顶部液晶 / 点阵接口 ============ */
    blackHeader(svg, 380, 106, 14, 2, 17);
    var lcdShadow = box(svg, 302, 102, 336, 9, 3, '#08243f');
    lcdShadow.setAttribute('opacity', '.32');
    silk(svg, 382, 172, '液晶接口', 5.5);

    /* ============ 8×8 点阵 ============ */
    box(svg, 418, 146, 180, 180, 2, '#171a1f', '#08090c');
    for (var mr = 0; mr < 8; mr++) {
      for (var mc = 0; mc < 8; mc++) {
        circ(svg, 430 + mc * 22, 158 + mr * 22, 6, '#282d34');
      }
    }
    silk(svg, 418, 338, '8×8 点阵屏 · 74HC595 驱动', 6.5);
    hot(414, 142, 188, 188, '8×8 点阵屏：由 74HC595 串行移位驱动。本仿真只还原外观，没有驱动它。');

    /* ============ 8 个 LED（右侧一排） ============ */
    ledEls = []; ledHalo = [];
    for (var j = 0; j < 8; j++) {
      var cx = 432 + j * 22;
      ledHalo.push(circ(svg, cx, 358, 11, '#ff7a4a'));
      ledHalo[j].setAttribute('opacity', 0);
      circ(svg, cx, 358, 7.5, '#1d232b', '#3b4450', .8);
      ledEls.push(circ(svg, cx, 358, 5.5, '#7d3a30'));
      silk(svg, cx, 377, 'D' + (j + 1), 5, 'middle', { fill: '#dbe8f7' });
    }
    hot(418, 344, 182, 40, '8 个 LED：接 P2 口，低电平点亮（写 0 亮、写 1 灭）。D1 对应 P2.0，D8 对应 P2.7。');

    /* ============ 主控：青色锁紧座 + 单片机 ============ */
    yellowHeader(svg, 238, 300, 12, 20, true);
    yellowHeader(svg, 378, 300, 12, 20, true);
    box(svg, 258, 298, 112, 262, 4, '#31b3b8', '#1d8489', 1);
    box(svg, 266, 306, 96, 246, 3, '#2ba3a8');
    box(svg, 276, 314, 76, 186, 2, '#1b2027', '#0a0d11');
    var chipLbl = svgEl('g', { transform: 'rotate(-90 314 407)' }, svg);
    svgText(chipLbl, 314, 412, 'STC 89C52RC', {
      'font-size': 14, fill: '#cfd6dd', 'text-anchor': 'middle',
      'font-family': 'Consolas, monospace', 'font-weight': 700, 'letter-spacing': .8
    });
    for (var cp = 0; cp < 20; cp++) {
      box(svg, 268, 320 + cp * 9, 8, 4, .5, '#c3cad1');
      box(svg, 352, 320 + cp * 9, 8, 4, .5, '#c3cad1');
    }
    box(svg, 262, 500, 104, 52, 3, '#2fb0b5', '#1d8489');
    var lever = svgEl('path', {
      d: 'M270 526 Q314 548 358 526', fill: 'none', stroke: '#cfd6dd', 'stroke-width': 3
    }, svg);
    lever.setAttribute('stroke-linecap', 'round');
    circ(svg, 314, 540, 3, '#1d8489');
    silk(svg, 258, 292, '主控芯片', 6);
    hot(254, 294, 120, 266, '主控芯片 STC89C52RC：40 脚，12 兆晶振（一个机器周期 = 1 微秒）。仿真执行的就是烧进这里的程序。');

    /* 晶振 */
    box(svg, 400, 288, 34, 14, 6, '#c9d1d9', '#8e99a4', .8);
    silk(svg, 417, 314, '晶振 12 兆', 5.5, 'middle', { fill: '#c6dcf5' });

    /* ============ 蜂鸣器 / 时钟芯片 / 电池 ============ */
    circ(svg, 68, 336, 27, '#20242a', '#0d1014', 1);
    circ(svg, 68, 336, 21, '#2b3037');
    buzzerEl = circ(svg, 68, 336, 15, '#333941', '#454d57', .8);
    circ(svg, 68, 336, 3, '#0d1014');
    buzzerText = silk(svg, 68, 372, '蜂鸣器 · 翻转 0 次', 5.5, 'middle', { fill: '#c6dcf5' });
    hot(38, 306, 60, 74, '蜂鸣器：接 P1.5。程序让它不停翻转（0→1→0）就会发声，右上角按钮可以开声音。');

    box(svg, 112, 306, 76, 44, 2, '#1d4f8c', '#123a6b');
    box(svg, 120, 312, 26, 14, 1, '#1a1d22');
    for (var d13 = 0; d13 < 4; d13++) box(svg, 116, 314 + d13 * 4, 4, 2, .3, '#b9c0c7');
    box(svg, 156, 316, 24, 10, 4, '#c9d1d9', '#8e99a4', .6);
    silk(svg, 112, 300, '时钟芯片 DS1302', 5.5);

    circ(svg, 96, 288, 12, '#c8ced5', '#8b959e', .8);
    circ(svg, 96, 288, 8, '#aab3bb');
    silk(svg, 96, 306, '时钟电池', 5, 'middle', { fill: '#c6dcf5' });
    hot(82, 272, 116, 82, '时钟芯片 DS1302 与备用电池：接 P3.4~P3.6，可掉电走时。本仿真只还原外观，没有驱动它。');

    /* ============ 模数 / 数模模块 ============ */
    silk(svg, 34, 394, '模数转换 XPT2046', 5.5, 'start', { fill: '#c6dcf5' });
    box(svg, 34, 400, 116, 34, 2, '#1d4f8c', '#123a6b');
    box(svg, 42, 406, 26, 22, 2, '#2a6fbf', '#1b4a7e');
    circ(svg, 55, 417, 6, '#d8dee4');
    box(svg, 78, 408, 30, 12, 1, '#1a1d22');

    silk(svg, 34, 444, '数模转换 LM358', 5.5, 'start', { fill: '#c6dcf5' });
    box(svg, 34, 450, 116, 30, 2, '#1b6b4a', '#0f4730');
    box(svg, 42, 456, 26, 18, 2, '#2a6fbf', '#1b4a7e');
    circ(svg, 55, 465, 5, '#d8dee4');
    box(svg, 78, 458, 26, 12, 1, '#1a1d22');
    hot(30, 386, 124, 96, '模数 / 数模模块：XPT2046 采集电压做 AD 转换，LM358 运放把 PWM 变成模拟电压。外观还原，未驱动。');

    /* ============ 串口下载 / 电源 ============ */
    silk(svg, 34, 490, 'USB 转串口 CH340', 5.5);
    box(svg, 34, 496, 40, 24, 1.5, '#1a1d22');
    for (var u1 = 0; u1 < 8; u1++) {
      box(svg, 36 + u1 * 4.5, 492, 3, 4, .3, '#b9c0c7');
      box(svg, 36 + u1 * 4.5, 520, 3, 4, .3, '#b9c0c7');
    }
    box(svg, 92, 556, 46, 30, 3, '#b9bfc6', '#7d858d', .8);
    box(svg, 98, 561, 34, 20, 2, '#5c646c');
    silk(svg, 92, 600, 'USB 供电口', 5.5);
    box(svg, 156, 558, 46, 26, 3, '#2453a8', '#173a78');
    box(svg, 162, 563, 18, 15, 2, '#e8eef4');
    silk(svg, 156, 600, '电源开关', 5.5);
    hot(30, 484, 178, 122, 'USB 转串口（CH340）、USB 供电口、电源开关：真板子靠这里下载程序和供电；仿真不需要，仅还原外观。');

    /* ============ 4×4 矩阵键盘：可以真的按 ============ */
    var kx0 = 424, ky0 = 392, kp = 44, ks = 30;
    for (var kr = 0; kr < 4; kr++) {
      for (var kc = 0; kc < 4; kc++) {
        var bx = kx0 + kc * kp, by = ky0 + kr * kp;
        var kg = svgEl('g', { style: 'cursor:pointer' }, svg);
        kg.setAttribute('data-mkey', kr + ',' + kc);
        box(kg, bx, by, ks, ks, 3, '#b8bfc6', '#8c959e', .8);
        var kface = box(kg, bx + 3, by + 3, ks - 6, ks - 6, 2, '#e9edf0', '#c2cad2', .6);
        circ(kg, bx + ks / 2, by + ks / 2, 2.8, '#b5573a');
        /* 键面印的就是 MatrixKey() 返回的键码：第 c 列第 r 行 = c*4+r+1 */
        silk(kg, bx + ks / 2, by + ks + 9, String(kc * 4 + kr + 1), 5, 'middle', { fill: '#c6dcf5' });
        bindMatrixKey(kr, kc, kg, kface, bx, by, ks);
      }
    }
    silk(svg, 424, 586, '4×4 矩阵键盘 · 可按住', 6.5);
    hot(418, 576, 184, 18, '4×4 矩阵键盘：行接 P1.7~P1.4，列接 P1.3~P1.0。把某一列拉低再读行就是"行列扫描"；键面上印的数字就是 MatrixKey() 返回的键码。按住任意一个键试试。');

    /* ============ 独立按键 K1~K4 ============ */
    var keyDefs = [['K1', 'P3.1'], ['K2', 'P3.0'], ['K3', 'P3.2'], ['K4', 'P3.3']];
    keyEls = {};
    keyDefs.forEach(function (kd, idx) {
      var bx = 148 + idx * 42, by = 634, s = 30;
      var g = svgEl('g', { style: 'cursor:pointer' }, svg);
      box(g, bx, by, s, s, 3, '#b8bfc6', '#8c959e', .8);
      var face = box(g, bx + 3, by + 3, s - 6, s - 6, 2, '#e9edf0', '#c2cad2', .6);
      circ(g, bx + s / 2, by + s / 2, 2.8, '#b5573a');
      silk(g, bx + s / 2, by + 42, kd[0], 7, 'middle', { 'font-weight': 700 });
      silk(g, bx + s / 2, by + 52, kd[1], 5.5, 'middle', { fill: '#c6dcf5' });
      keyEls[kd[0]] = { g: g, rect: face };
      bindKey(kd[0], kd[1], g, face, bx, by, s);
    });
    silk(svg, 148, 626, '独立按键 · 按住 = 低电平', 6);

    /* 无线模块接口 / 温度传感器 / 红外接收 */
    blackHeader(svg, 322, 638, 4, 2, 10);
    silk(svg, 322, 634, '无线模块接口', 5.5);
    box(svg, 388, 640, 14, 24, 2, '#1a1d22');
    silk(svg, 406, 656, '温度传感器', 5, 'start', { fill: '#c6dcf5' });
    circ(svg, 392, 686, 8, '#14181d');
    silk(svg, 406, 690, '红外接收', 5, 'start', { fill: '#c6dcf5' });
    hot(316, 628, 116, 70, '无线模块接口（NRF24L01）、温度传感器 DS18B20、红外接收头：外观还原，本仿真未驱动。');

    /* 跳线帽 */
    [[300, 610], [340, 610], [196, 480], [196, 510]].forEach(function (jp) {
      box(svg, jp[0], jp[1], 14, 18, 1.5, '#e2c235', '#a98d19', .6);
      box(svg, jp[0] + 3, jp[1] + 3, 8, 3, .6, '#3a2f08');
      box(svg, jp[0] + 3, jp[1] + 12, 8, 3, .6, '#3a2f08');
    });

    /* 零散贴片元件：还原真实板上密密麻麻的观感 */
    var smd = [
      [196, 330, 14, 8, 'r'], [196, 346, 14, 8, 'r'], [216, 330, 8, 12, 'c'],
      [196, 392, 16, 7, 'r'], [196, 406, 16, 7, 'r'], [218, 392, 8, 12, 'c'],
      [196, 440, 14, 8, 'r'], [218, 440, 8, 12, 'c'],
      [196, 458, 14, 8, 'r'], [218, 458, 8, 12, 'c']
    ];
    smd.forEach(function (q) {
      if (q[4] === 'r') {
        box(svg, q[0], q[1], q[2], q[3], 1, '#d9cba4', '#a3936c', .5);
        box(svg, q[0] - 2, q[1], 2, q[3], .4, '#c9ccd0');
        box(svg, q[0] + q[2], q[1], 2, q[3], .4, '#c9ccd0');
      } else {
        box(svg, q[0], q[1], q[2], q[3], 1, '#c8b9a2', '#9c8d78', .5);
        box(svg, q[0], q[1] - 2, q[2], 2, .4, '#c9ccd0');
        box(svg, q[0], q[1] + q[3], q[2], 2, .4, '#c9ccd0');
      }
    });
    silk(svg, 238, 570, 'P0~P3 排针', 5.5, 'start', { fill: '#c6dcf5' });

    /* 悬停热区：透明命中矩形，鼠标移上去由取景框标出范围并显示说明 */
    hotRegions.forEach(function (rg) {
      var hit = box(svg, rg[0], rg[1], rg[2], rg[3], 4, 'rgba(0,0,0,0)', 'none');
      hit.setAttribute('pointer-events', 'all');
      hit.addEventListener('mouseenter', function () { showReticle(rg); setTip(rg[4]); });
      hit.addEventListener('mouseleave', function () { hideReticle(); setTip(''); });
    });
  }

  /* ---------------- 按键 ---------------- */
  var matDown = {};      /* 矩阵键盘按下状态：普通键值对，重新编译后要把按住的状态补回去 */
  var matFaces = {};     /* 对应的键面元素，用来做按下/弹起的视觉反馈 */
  var matTouch = {};     /* 矩阵键由哪根手指按着（pointerId），'kb' 表示键盘按的 */
  var keyFaces = {};     /* K1~K4 的键面元素，键盘映射按下时也要同步高亮 */

  function paintMatrix() {
    Object.keys(matDown).forEach(function (k) {
      var f = matFaces[k];
      if (f && f.setAttribute) f.setAttribute('fill', matDown[k] ? '#b7c4d2' : '#e9edf0');
    });
  }
  /* build() 会新建硬件对象，把仍然按着的键补回新对象，否则按住运行会"丢键" */
  function reapplyMatrix() {
    if (!hw) return;
    Object.keys(matDown).forEach(function (k) {
      if (matDown[k]) hw.pressMatrix(Math.floor(+k / 4), (+k) % 4, true);
    });
  }

  function bindMatrixKey(r, c, g, face, bx, by, ks) {
    var code = c * 4 + r + 1;
    var tip = '矩阵键盘 · 第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 列，键码 ' + code
      + '：列拉低后这一行读到 0，MatrixKey() 就返回 ' + code + '。按住不放才能让程序读到。';
    var key = r * 4 + c;
    matFaces[key] = face;
    function down(e) {
      if (e && e.preventDefault) e.preventDefault();
      var pid = e && e.pointerId != null ? e.pointerId : 1;
      /* 同一个键已经被另一根手指按着就不再重复按下 */
      if (matDown[key] && matTouch[key] != null && matTouch[key] !== pid) return;
      if (!vm) build();
      if (!vm) return;
      matDown[key] = 1;
      matTouch[key] = pid;
      hw.pressMatrix(r, c, true);
      forceRender = true;
      face.setAttribute('fill', '#b7c4d2');
    }
    function up(e) {
      if (!matDown[key]) return;
      /* 多指操作：只回应按下这根键的那根手指 */
      if (e && e.pointerId != null && matTouch[key] != null && e.pointerId !== matTouch[key]) return;
      matDown[key] = 0;
      delete matTouch[key];
      if (vm) hw.pressMatrix(r, c, false);
      face.setAttribute('fill', '#e9edf0');
    }
    g.addEventListener('pointerdown', down);
    g.addEventListener('pointerup', up);
    g.addEventListener('pointerleave', up);
    g.addEventListener('mouseenter', function () {
      showReticle([bx - 2, by - 2, ks + 4, ks + 6, tip]);
      setTip(tip);
    });
    g.addEventListener('mouseleave', function () { hideReticle(); setTip(''); });
  }

  function bindKey(key, pin, g, rect, bx, by, size) {
    keyFaces[key] = rect;
    var tip = '独立按键 ' + key + '：接 ' + pin + '，按住时这个引脚是低电平，松开变回高电平。用鼠标按住它试试。';
    var holdId = null;   /* 按下这根键的 pointerId，松开时只认它 */
    function down(e) {
      e.preventDefault();
      if (holdId !== null) return;
      if (!vm) build();
      if (!vm) return;
      holdId = e && e.pointerId != null ? e.pointerId : 1;
      hw.setKey(vm, key, true);
      forceRender = true;
      rect.setAttribute('fill', '#b7c4d2');
    }
    function up(e) {
      if (holdId === null) return;
      if (e && e.pointerId != null && e.pointerId !== holdId) return;
      holdId = null;
      if (!vm) return;
      hw.setKey(vm, key, false);
      forceRender = true;
      rect.setAttribute('fill', '#e9edf0');
    }
    g.addEventListener('pointerdown', down);
    g.addEventListener('mouseenter', function () {
      showReticle([bx - 2, by - 2, size + 4, size + 6, tip]);
      setTip(tip);
    });
    g.addEventListener('mouseleave', function () { hideReticle(); setTip(''); });
    window.addEventListener('pointerup', up);
    g.addEventListener('pointerleave', up);
  }

  /* 鼠标在任何地方松开都算松手，避免拖出键面后一直处于按下状态 */
  window.addEventListener('pointerup', function (e) {
    var any = false;
    Object.keys(matDown).forEach(function (k) {
      if (!matDown[k]) return;
      if (matTouch[k] === 'kb') return;          /* 键盘按住的键，等 keyup 再松 */
      if (e && e.pointerId != null && matTouch[k] != null && e.pointerId !== matTouch[k]) return;
      matDown[k] = 0;
      delete matTouch[k];
      any = true;
      if (vm) hw.pressMatrix(Math.floor(+k / 4), (+k) % 4, false);
    });
    if (any) paintMatrix();
  });

  /* ---------------- 键盘映射 ----------------
     开发板页可以直接敲电脑键盘：
       K1~K4        → 7 8 9 0
       4×4 矩阵键盘 → Q W E R / A S D F / Z X C V / 1 2 3 4
     焦点在输入框里时不抢键；切走窗口时把按住的键全部松开。
  ------------------------------------------------------------------ */
  var KEYMAP_SINGLE = { '7': 'K1', '8': 'K2', '9': 'K3', '0': 'K4' };
  var KEYMAP_MATRIX = {
    q: [0, 0], w: [0, 1], e: [0, 2], r: [0, 3],
    a: [1, 0], s: [1, 1], d: [1, 2], f: [1, 3],
    z: [2, 0], x: [2, 1], c: [2, 2], v: [2, 3],
    '1': [3, 0], '2': [3, 1], '3': [3, 2], '4': [3, 3]
  };
  var kbHeld = {};
  function isTyping(t) {
    if (!t) return false;
    var tag = String(t.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!(t.isContentEditable || (t.getAttribute && t.getAttribute('contenteditable') === 'true'));
  }
  function kbPress(k, down) {
    var sk = KEYMAP_SINGLE[k], rc = KEYMAP_MATRIX[k];
    if (!sk && !rc) return false;
    if (down) {
      if (!vm) build();
      if (!vm) return false;
      forceRender = true;
      if (sk) {
        hw.setKey(vm, sk, true);
        if (keyFaces[sk]) keyFaces[sk].setAttribute('fill', '#b7c4d2');
      } else {
        var id = rc[0] * 4 + rc[1];
        matDown[id] = 1;
        matTouch[id] = 'kb';
        hw.pressMatrix(rc[0], rc[1], true);
        if (matFaces[id]) matFaces[id].setAttribute('fill', '#b7c4d2');
      }
    } else {
      if (!vm) return true;
      forceRender = true;
      if (sk) {
        hw.setKey(vm, sk, false);
        if (keyFaces[sk]) keyFaces[sk].setAttribute('fill', '#e9edf0');
      } else {
        var id2 = rc[0] * 4 + rc[1];
        matDown[id2] = 0;
        delete matTouch[id2];
        hw.pressMatrix(rc[0], rc[1], false);
        if (matFaces[id2]) matFaces[id2].setAttribute('fill', '#e9edf0');
      }
    }
    return true;
  }
  document.addEventListener('keydown', function (e) {
    if (curPage !== 'board' || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    if (isTyping(e.target)) return;
    var k = String(e.key || '').toLowerCase();
    if (kbHeld[k]) return;
    if (!KEYMAP_SINGLE[k] && !KEYMAP_MATRIX[k]) return;
    if (e.preventDefault) e.preventDefault();
    if (kbPress(k, true)) kbHeld[k] = 1;
  });
  document.addEventListener('keyup', function (e) {
    var k = String(e.key || '').toLowerCase();
    if (!kbHeld[k]) return;
    delete kbHeld[k];
    kbPress(k, false);
  });
  window.addEventListener('blur', function () {
    Object.keys(kbHeld).forEach(function (k) { kbPress(k, false); });
    kbHeld = {};
  });

  /* ---------------- 端口监视 ---------------- */
  var PORT_USE = {
    P0: 'P0 口：写 1 时点亮对应数码管段（共阴段码）；用 1602 时 P0 又当数据总线。',
    P1: 'P1 口：P1.7~P1.4 是矩阵键盘的 4 行，P1.3~P1.0 是 4 列，P1.5 同时接了蜂鸣器。',
    P2: 'P2 口：P2.0~P2.7 接 8 个 LED（写 0 点亮）；P2.2~P2.4 还给数码管做位选，P2.5~P2.7 接 1602 的 RW / E / RS。',
    P3: 'P3 口：P3.1 / P3.0 / P3.2 / P3.3 接 K1~K4 独立按键，按住时是低电平。'
  };
  var SEG_NAME = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
  var KEY_OF_P3 = { 1: 'K1', 0: 'K2', 2: 'K3', 3: 'K4' };
  function pinHint(p, bit) {
    if (p === 'P2') return 'P2.' + bit + ' → D' + (bit + 1) + ' 号 LED，写 0 点亮。';
    if (p === 'P0') return 'P0.' + bit + ' → 数码管 ' + SEG_NAME[bit] + ' 段，写 1 点亮。';
    if (p === 'P3') return KEY_OF_P3[bit]
      ? 'P3.' + bit + ' → ' + KEY_OF_P3[bit] + ' 独立按键，按住时是 0。'
      : 'P3.' + bit + ' 在这个板子上没有接外设。';
    if (p === 'P1') {
      if (bit === 5) return 'P1.5 → 蜂鸣器，电平不停翻转就发声。';
      if (bit >= 4) return 'P1.' + bit + ' → 矩阵键盘第 ' + (8 - bit) + ' 行（被扫描的那一列有键按下时读到 0）。';
      return 'P1.' + bit + ' → 矩阵键盘第 ' + (4 - bit) + ' 列，程序把它拉低来扫描这一列。';
    }
    return '';
  }

  function buildPorts() {
    var host = $('ports');
    host.innerHTML = '';
    ['P0', 'P1', 'P2', 'P3'].forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'port-row';
      var nm = document.createElement('span');
      nm.className = 'port-name'; nm.textContent = p;
      if (nm.addEventListener) {
        nm.addEventListener('mouseenter', function () { setTip(PORT_USE[p]); });
        nm.addEventListener('mouseleave', function () { setTip(''); });
      }
      row.appendChild(nm);
      var bits = document.createElement('span');
      bits.className = 'bits';
      portBits[p] = [];
      for (var b = 7; b >= 0; b--) {
        (function (bit) {
          var be = document.createElement('span');
          be.className = 'bit'; be.textContent = '1';
          if (be.addEventListener) {
            be.addEventListener('mouseenter', function () { setTip(pinHint(p, bit)); });
            be.addEventListener('mouseleave', function () { setTip(''); });
          }
          bits.appendChild(be);
          portBits[p][bit] = be;
        })(b);
      }
      row.appendChild(bits);
      var hx = document.createElement('span');
      hx.className = 'hexval'; hx.textContent = '0xFF';
      row.appendChild(hx);
      portHex[p] = hx;
      host.appendChild(row);
    });
  }

  /* ---------------- 例程 ---------------- */
  function buildExamples() {
    var host = $('ex-list');
    var sel = $('ex-select');
    window.EXAMPLES.forEach(function (ex, i) {
      var b = document.createElement('button');
      b.className = 'ex-btn';
      b.dataset.id = ex.id;
      var n = document.createElement('span');
      n.className = 'n';
      n.textContent = (i + 1 < 10 ? '0' : '') + (i + 1);
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = ex.title;
      b.appendChild(n);
      b.appendChild(t);
      b.onclick = function () { loadExample(ex.id); };
      host.appendChild(b);
      if (sel) {
        var o = document.createElement('option');
        o.value = ex.id;
        o.textContent = (i + 1 < 10 ? '0' : '') + (i + 1) + '  ' + ex.title;
        sel.appendChild(o);
      }
    });
    if (sel) {
      sel.onchange = function () {
        if (this.value) { loadExample(this.value); setPage('code'); }
      };
    }
  }

  /* 讲义页「在编辑器打开」：当前例程在加载时已进编辑器，这里只负责切页聚焦 */
  (function () {
    var b = $('btn-open-code');
    if (!b || !b.addEventListener) return;
    b.addEventListener('click', function () {
      if (!curExample) return;
      if (project.fs) {
        log('当前连接着磁盘文件夹「' + FS.name + '」。要先点工程树上的「断开」，才能载入讲义例程。', 'err');
        return;
      }
      setPage('code');
      if (codeEl && codeEl.focus) codeEl.focus();
    });
  })();

  /* ---------------- 页面导航 ----------------
     胶囊本身就是主导航：写代码 / 开发板 / 时序图 / 讲义。
     开发板卡片是一块整体，在两个页面之间搬动（不重新渲染，省得丢状态）。
     分层同 ui-studies：capsule 玻璃容器 → hover-pill 灰色悬停底（即时跟随）
     → blob 白色主指示块（阻尼弹簧追赶，速度驱动液态形变）→ 文字层反色
  ---------------------------------------------------------------- */
  var PAGE_ORDER = ['code', 'board', 'scope', 'notes'];
  var curPage = 'code';
  var capsuleGo = null;   /* 由 initCapsule 注入：把白色滑块移到对应页面 */

  function setPage(name) {
    if (PAGE_ORDER.indexOf(name) < 0) return;
    curPage = name;
    for (var i = 0; i < PAGE_ORDER.length; i++) {
      var el = $('page-' + PAGE_ORDER[i]);
      if (el && el.classList) {
        if (PAGE_ORDER[i] === name) el.classList.add('active'); else el.classList.remove('active');
      }
    }
    if (capsuleGo) capsuleGo(name);
    var slot = $(name === 'board' ? 'slot-board-main' : 'slot-code-board');
    var card = $('board-card');
    if (slot && card && card.parentNode !== slot) slot.appendChild(card);
    if (name !== 'board') {
      pauseHardwareView();
      if (boardView !== 'native') updateButtons();
    }
    if (name === 'scope') { autoSpan(); drawScope(); }
    if (name === 'code') { refreshGutter(); paintCode(); syncCodeScroll(); }
    if (name === 'notes') updateFade();
    closeZoom();            /* 换页时别让全屏板盖在新页面上 */
    updateZoomLabel();      /* 按钮文案跟着当前页面走 */
    syncTipPos();           /* 说明条的位置随页面切换 */
    forceRender = true;
    if (name === 'board' && !boardViewRestored) {
      boardViewRestored = true;
      var sv = readSavedBoardView();
      if (sv !== 'native') setBoardView(sv);
    }
  }

  /* ==================== 开发板视图：功能板 / 引脚板 / 硬件工具 ==================== */
  var boardView = 'native';
  var hwReady = false, hwWanted = 'pindemo', pinState = 'stopped', hwHintTimer = 0;
  var BOARD_VIEW_KEY = 'mcu51.boardview.v1';
  var boardViewRestored = false;
  var TOOL_LABELS = { lab: '电路实验台', eda: '画板模拟', calc: '参数计算器', quiz: '自测练习' };

  function readSavedBoardView() {
    try {
      var v = localStorage.getItem(BOARD_VIEW_KEY);
      return ['native', 'pin', 'lab', 'eda', 'calc', 'quiz'].indexOf(v) >= 0 ? v : 'native';
    } catch (e) { return 'native'; }
  }
  function saveBoardView(v) {
    try { localStorage.setItem(BOARD_VIEW_KEY, v); } catch (e) {}
  }
  function updateBoardViewUI(view) {
    var btns = document.querySelectorAll('#board-view-tabs button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-view') === view;
      btns[i].classList.toggle('on', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var pop = $('hw-menu-pop'), label = $('hw-menu-label'), btn = $('hw-menu-btn');
    if (pop) {
      var items = pop.querySelectorAll('button[data-view]');
      for (var j = 0; j < items.length; j++) {
        items[j].classList.toggle('on', items[j].getAttribute('data-view') === view);
      }
    }
    if (btn && label) {
      var tool = !!TOOL_LABELS[view];
      btn.classList.toggle('on', tool);
      label.textContent = tool ? TOOL_LABELS[view] : '硬件工具';
    }
  }
  function pinGaps(text) {
    var gaps = [], t = text || '';
    if (/#include\s*[<"](LCD|LCD1602|LCD12864)/i.test(t) || /\bLCD_[A-Za-z0-9_]*\s*\(/i.test(t)) gaps.push('LCD');
    if (/\b(SBUF|SCON)\b/.test(t)) gaps.push('串口');
    if (/\b(interrupt\s+\d|TMOD|TH0|TL0|TH1|TL1)\b/i.test(t)) gaps.push('定时器/中断');
    if (/\bPic\s*\[/.test(t)) gaps.push('8×8 点阵');
    return gaps;
  }
  function updatePinCapNote(text) {
    var box = $('pin-cap-note'), note = $('pin-cap-text');
    if (!box || !note) return;
    if (boardView !== 'pin') { box.hidden = true; return; }
    var src = text != null ? text : currentSource().text;
    var gaps = pinGaps(src);
    var multi = (project.files || []).filter(function (x) { return /\.c$/i.test(x.path); }).length > 1;
    var parts = [];
    if (gaps.length) parts.push('当前代码用到 ' + gaps.join('、') + '，引脚板不显示这部分');
    if (multi) parts.push('多文件工程只运行当前文件');
    if (!parts.length) { box.hidden = true; return; }
    note.textContent = parts.join('；') + '。完整效果请用功能板。';
    box.hidden = false;
  }

  function boardHwFrame() { return $('hw-frame'); }
  function postHw(msg) {
    var fr = boardHwFrame();
    if (!fr || !fr.contentWindow || !hwReady) return false;
    try { fr.contentWindow.postMessage(msg, '*'); return true; } catch (e) { return false; }
  }
  function hwViewName(v) { return v === 'pin' ? 'pindemo' : v; }
  function hex2(v) {
    if (v == null || !isFinite(v)) return '--';
    var s = (v & 0xFF).toString(16).toUpperCase();
    return '0x' + (s.length < 2 ? '0' + s : s);
  }
  function setBoardHint(text, isErr) {
    var h = $('board-view-hint');
    if (!h) return;
    h.textContent = text;
    h.style.color = isErr ? 'var(--danger)' : '';
    if (hwHintTimer) { clearTimeout(hwHintTimer); hwHintTimer = 0; }
    if (isErr) hwHintTimer = setTimeout(function () {
      if (boardView === 'pin') setBoardHint('引脚板 · 已停止');
      else if (boardView !== 'native') setBoardHint('硬件工具 · 不运行代码');
    }, 5000);
  }
  function currentSource() {
    var f = fileOf(project.active);
    if (!f || !/\.(c|h)$/i.test(f.path)) f = fileOf('main.c') || f;
    if (!f) return { name: 'main.c', text: codeEl ? codeEl.value : '' };
    var text = (f.path === project.active && codeEl) ? codeEl.value : f.content;
    return { name: f.path, text: text };
  }
  function sendPinCode() {
    var s = currentSource();
    if (!s) return null;
    postHw({ type: 'hw:code', name: s.name, text: s.text });
    updatePinCapNote(s.text);
    return s;
  }
  function loadHwFrame(view) {
    var fr = boardHwFrame();
    if (!fr) return;
    if (!fr.getAttribute('src')) fr.src = 'hardware.html#' + hwViewName(view);
  }
  function pauseHardwareView() {
    if (pinState === 'running') postHw({ type: 'hw:pause' });
  }
  function setBoardView(view) {
    var page = $('page-board');
    if (!page) return;
    if (view !== 'native' && view !== 'pin' && !TOOL_LABELS[view]) view = 'native';
    if (view !== 'pin' && pinState === 'running') postHw({ type: 'hw:pause' });
    boardView = view;
    saveBoardView(view);
    page.classList.toggle('hw-mode', view !== 'native');
    updateBoardViewUI(view);
    var box = $('pin-cap-note');
    if (view !== 'pin' && box) box.hidden = true;
    if (view === 'native') {
      setBoardHint('功能板 · 运行当前工程');
      updateButtons();
      forceRender = true;
      return;
    }
    closeZoom();
    if (curPage !== 'board') setPage('board');
    loadHwFrame(view);
    hwWanted = hwViewName(view);
    if (hwReady) postHw({ type: 'hw:view', view: hwWanted });
    if (view === 'pin') {
      setBoardHint('引脚板 · 已停止');
      sendPinCode();
    } else {
      setBoardHint('硬件工具 · 不运行代码');
    }
  }
  function hwRun() {
    if (boardView !== 'pin') { setBoardHint('这个视图不运行代码', true); return; }
    if (!hwReady) { setBoardHint('引脚板还在加载，稍等一下', true); return; }
    sendPinCode();
    postHw({ type: 'hw:run' });
  }
  (function initBoardViewTabs() {
    var tabs = $('board-view-tabs');
    var menuBtn = $('hw-menu-btn'), pop = $('hw-menu-pop');
    function closeMenu() {
      if (pop) pop.hidden = true;
      if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
    }
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
        if (b) setBoardView(b.getAttribute('data-view'));
      });
    }
    if (menuBtn && pop) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
        menuBtn.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
      });
      pop.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-view]') : null;
        if (b) { closeMenu(); setBoardView(b.getAttribute('data-view')); }
      });
      document.addEventListener('click', function (e) {
        if (pop.hidden) return;
        if (pop.contains(e.target) || menuBtn.contains(e.target)) return;
        closeMenu();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !pop.hidden) closeMenu();
      });
    }
    var back = $('pin-cap-back');
    if (back) back.addEventListener('click', function () { setBoardView('native'); });
    updateBoardViewUI(boardView);
  })();

  /* ==================== 首次进入的快速开始条 ==================== */
  var QUICK_KEY = 'mcu51.quickstart.v1';
  function quickSeen() {
    try { return localStorage.getItem(QUICK_KEY) === '1'; } catch (e) { return true; }
  }
  function closeQuick() {
    var q = $('quickbar');
    if (q) q.hidden = true;
    try { localStorage.setItem(QUICK_KEY, '1'); } catch (e) {}
  }
  (function initQuick() {
    var q = $('quickbar');
    if (!q) return;
    if (!quickSeen()) q.hidden = false;
    $('quickbar-close').onclick = closeQuick;
    $('quickbar-go').onclick = function () { closeQuick(); setPage('board'); };
  })();

  /* 硬件页 → 主应用 */
  window.addEventListener('message', function (e) {
    var fr = boardHwFrame();
    if (!fr || !fr.contentWindow || e.source !== fr.contentWindow) return;
    var d = e.data || {};
    if (d.type === 'hw:ready') {
      hwReady = true;
      postHw({ type: 'hw:view', view: hwWanted });
      if (boardView === 'pin') sendPinCode();
      return;
    }
    if (d.type === 'hw:state') {
      pinState = d.state || 'stopped';
      if (boardView === 'pin' && curPage === 'board') {
        var label = $('btn-run-label');
        if (label) label.textContent = pinState === 'paused' ? '继续' : '运行';
        var p = $('btn-pause');
        if (p) p.disabled = pinState !== 'running';
        var ports = d.ports || {};
        var txt = pinState === 'running' ? '运行中' : (pinState === 'paused' ? '已暂停' : '已停止');
        if (d.error) setBoardHint('引脚板错误：' + d.error, true);
        else setBoardHint('引脚板 · ' + txt + ' · P0=' + hex2(ports.P0) + ' P1=' + hex2(ports.P1) +
          ' P2=' + hex2(ports.P2) + ' P3=' + hex2(ports.P3));
      }
      return;
    }
    if (d.type === 'hw:error') setBoardHint('引脚板错误：' + d.text, true);
  });

  (function initCapsule() {
    var cap = $('capsule');
    if (!cap || !cap.querySelectorAll) return;
    var items = Array.prototype.slice.call(cap.querySelectorAll('.nav-item'));
    if (items.length < 2) return;
    var blob = cap.querySelector('.blob');
    var hoverPill = cap.querySelector('.hover-pill');
    if (!blob || !hoverPill) return;

    var active = 0, hover = -1;
    var s = { x: 0, w: 0, vx: 0, vw: 0 };
    var raf = 0, last = 0;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function itemRect(i) {
      var w = items[i].offsetWidth || 0;
      var x = items[i].offsetLeft || 0;
      return { x: x, w: w };
    }
    /* 色块中心接近某项中心时把该项文字翻成深色，避免只盖住半个字 */
    function paintLabels() {
      var cx = s.x + s.w / 2;
      for (var i = 0; i < items.length; i++) {
        var r = itemRect(i);
        var near = r.w > 0 && Math.abs(cx - (r.x + r.w / 2)) < r.w * 0.2;
        items[i].classList.toggle('ink', near || i === hover);
      }
    }
    function draw() {
      var v = Math.min(1, Math.abs(s.vx) / 650);
      blob.style.width = s.w.toFixed(2) + 'px';
      blob.style.transform =
        'translate3d(' + s.x.toFixed(2) + 'px,0,0)' +
        ' skewX(' + Math.max(-5, Math.min(5, -s.vx * 0.006)).toFixed(2) + 'deg)' +
        ' scaleX(' + (1 + v * 0.055).toFixed(3) + ')' +
        ' scaleY(' + (1 - v * 0.06).toFixed(3) + ')';
      var dir = s.vx >= 0 ? 1 : -1;
      blob.style.setProperty('--lead', (dir > 0 ? 100 : 0) + '%');
      blob.style.setProperty('--bulge', (v * 0.86).toFixed(3));
      blob.style.setProperty('--tilt', (dir * v * 14).toFixed(1) + 'deg');
      blob.style.borderRadius =
        (50 - v * 6).toFixed(1) + '% ' + (50 + v * 5).toFixed(1) + '% ' +
        (50 - v * 4).toFixed(1) + '% ' + (50 + v * 6).toFixed(1) + '% / ' +
        (50 - v * 7).toFixed(1) + '% ' + (50 + v * 6).toFixed(1) + '% ' +
        (50 - v * 5).toFixed(1) + '% ' + (50 + v * 6).toFixed(1) + '%';
      paintLabels();
    }
    function snap(i) {
      var r = itemRect(i);
      s.x = r.x; s.w = r.w; s.vx = 0; s.vw = 0;
      draw();
    }
    function placeHover(i) {
      if (i < 0) { hoverPill.style.opacity = '0'; return; }
      var r = itemRect(i);
      hoverPill.style.left = r.x + 'px';
      hoverPill.style.width = r.w + 'px';
      hoverPill.style.opacity = '1';
    }
    function tick(now) {
      raf = 0;
      var dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
      last = now;
      var r = itemRect(hover >= 0 ? hover : active);
      if (reduceMotion) { s.x = r.x; s.w = r.w; s.vx = 0; s.vw = 0; draw(); return; }
      var K = 55, D = 8;
      var ax = (r.x - s.x) * K - s.vx * D;
      s.vx += ax * dt; s.x += s.vx * dt;
      var aw = (r.w - s.w) * K - s.vw * D;
      s.vw += aw * dt; s.w += s.vw * dt;
      draw();
      var settled = Math.abs(r.x - s.x) < 0.35 && Math.abs(s.vx) < 0.35 &&
        Math.abs(r.w - s.w) < 0.35 && Math.abs(s.vw) < 0.35;
      if (settled) { s.x = r.x; s.w = r.w; s.vx = 0; s.vw = 0; draw(); last = 0; return; }
      raf = requestAnimationFrame(tick);
    }
    function wake() {
      if (!raf) { last = (window.performance && performance.now) ? performance.now() : Date.now(); raf = requestAnimationFrame(tick); }
    }

    items.forEach(function (item, i) {
      item.addEventListener('pointerenter', function () { hover = i; placeHover(i); wake(); });
      item.addEventListener('focus', function () { hover = i; placeHover(i); wake(); });
      item.addEventListener('click', function () {
        active = i;
        hover = i;
        placeHover(i);
        setPage(item.dataset.page);
        wake();
      });
    });
    cap.addEventListener('pointerleave', function () { hover = -1; placeHover(-1); wake(); });
    window.addEventListener('resize', function () {
      if (hover < 0) snap(active); else { placeHover(hover); wake(); }
    });

    capsuleGo = function (name) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].dataset && items[i].dataset.page === name) {
          active = i;
          hover = -1;
          placeHover(-1);
          snap(i);
          return;
        }
      }
    };

    snap(active);
    requestAnimationFrame(function () { snap(active); });
  })();

  /* ==================== 工程：多文件 + 真实磁盘 ====================
     两种模式，共用同一个 project 结构：
       ① 浏览器内工程（默认）：内容存在 localStorage，刷新不丢，但不落盘；
       ② 磁盘文件夹：File System Access API 直接读写电脑上的真实目录，
          每个文件带 handle，点「保存」（或 Ctrl+S）写回原文件。
     path 一律用 / 分隔，相对文件夹根。
  ============================================================== */
  var PROJ_PREFIX = 'c51lab.project.v1.';
  var TREE_KEY = 'c51lab.tree.v1';
  var FS_DB_KEY = 'c51lab.dir.v1';
  var LIMIT_FILES = 600;
  var MAX_DEPTH = 6;
  var SKIP_DIRS = { objects: 1, listings: 1, '.git': 1, node_modules: 1, '.vscode': 1, '.idea': 1, debugconfig: 1 };
  var TEXT_EXT = /\.(c|h|inc|s|asm|a51|cpp|hpp|txt|md|ini|json|uvprojx|uvoptx)$/i;

  var project = { name: '工程', files: [], folders: [], groups: [], open: [], active: '', fs: false };
  var GROUP_DEFAULT = 'Source Group 1';
  var collapsed = {};
  var lastUnit = null;
  var errFile = '';

  var FS = { supported: false, root: null, name: '', pending: null, busy: false };
  try {
    FS.supported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  } catch (e) { FS.supported = false; }

  /* ---------------- 路径工具 ---------------- */
  function baseName(p) { return String(p).split('/').pop(); }
  function dirName(p) { var a = String(p).split('/'); a.pop(); return a.join('/'); }
  function joinPath(a, b) { return a ? a + '/' + b : b; }
  function normPath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/').trim();
  }
  function cmpName(a, b) {
    return String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
  }

  function fileOf(path) {
    for (var i = 0; i < project.files.length; i++) {
      if (project.files[i].path === path) return project.files[i];
    }
    return null;
  }

  /* ---------------- 分组（Keil 的 Source Group） ---------------- */
  /* 旧存档没有 groups 字段，读入时补一个默认组，把已有文件全放进去。 */
  function ensureGroups(p) {
    p.groups = (p.groups || []).filter(function (g) { return g && typeof g.name === 'string' && g.name; });
    if (!p.groups.length) p.groups = [{ name: GROUP_DEFAULT, files: [] }];
    var seen = {};
    p.groups.forEach(function (g) {
      g.files = (g.files || []).filter(function (path) {
        if (seen[path]) return false;
        for (var i = 0; i < p.files.length; i++) {
          if (p.files[i].path === path) { seen[path] = 1; return true; }
        }
        return false;
      });
    });
    p.files.forEach(function (f) { if (!seen[f.path]) p.groups[0].files.push(f.path); });
    return p;
  }
  function groupOf(path) {
    for (var i = 0; i < project.groups.length; i++) {
      if (project.groups[i].files.indexOf(path) >= 0) return project.groups[i];
    }
    return null;
  }
  function addToGroup(path, groupName) {
    var g = null;
    for (var i = 0; i < project.groups.length; i++) {
      if (project.groups[i].name === groupName) { g = project.groups[i]; break; }
    }
    if (!g) g = project.groups[0];
    project.groups.forEach(function (x) {
      x.files = x.files.filter(function (p) { return p !== path; });
    });
    if (g) g.files.push(path);
  }
  function removeFromGroups(path) {
    project.groups.forEach(function (g) {
      g.files = g.files.filter(function (p) { return p !== path; });
    });
  }
  function renameInGroups(oldPath, newPath) {
    project.groups.forEach(function (g) {
      g.files = g.files.map(function (p) { return p === oldPath ? newPath : p; });
    });
  }
  function uniqueGroupName(base) {
    var name = base, n = 2;
    while (project.groups.some(function (g) { return g.name === name; })) name = base + ' ' + (n++);
    return name;
  }
  function dirtyCount() {
    var n = 0;
    for (var i = 0; i < project.files.length; i++) if (project.files[i].dirty) n++;
    return n;
  }

  /* ---------------- 存档（只用于浏览器内工程） ---------------- */
  function projStoreKey() { return PROJ_PREFIX + (curExample ? curExample.id : 'free'); }
  function saveProject() {
    var cur = fileOf(project.active);
    if (cur) cur.content = codeEl.value;
    if (project.fs) {
      /* 第一次改动时给树上的文件点亮小圆点，之后不再重绘（免得每敲一个字都重排） */
      if (cur && !cur.dirty) { cur.dirty = true; updateFsUi(); renderTree(); }
      return;                      /* 磁盘是唯一真相，不再往 localStorage 里塞一份 */
    }
    try { window.localStorage.setItem(projStoreKey(), JSON.stringify(project)); } catch (e) {}
  }
  function readProject(key) {
    try {
      var raw = window.localStorage.getItem(PROJ_PREFIX + key);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || !p.files || !p.files.length) return null;
      p.files = p.files.filter(function (f) { return f && f.path && typeof f.content === 'string'; });
      if (!p.files.length) return null;
      p.folders = (p.folders || []).filter(function (x) { return typeof x === 'string' && x; });
      p.folderGroup = (p.folderGroup && typeof p.folderGroup === 'object') ? p.folderGroup : {};
      p.open = (p.open || []).filter(function (x) {
        return p.files.some(function (f) { return f.path === x; });
      });
      if (!p.open.length) p.open = [p.files[0].path];
      if (!p.active || !p.files.some(function (f) { return f.path === p.active; })) p.active = p.open[0];
      p.name = p.name || '工程';
      p.fs = false;
      return ensureGroups(p);
    } catch (e) { return null; }
  }

  /* ---------------- 工程编译：逐文件解析 + 链接（实现放在 vm.js） ---------------- */
  function buildProgram() {
    return C51.compileProject(project.files);
  }

  function mapUnitLine(n) {
    if (!lastUnit || !lastUnit.map) return null;
    return lastUnit.map[n - 1] || null;
  }

  /* ---------------- 标签页 ---------------- */
  function renderTabs() {
    var host = $('tabs');
    if (!host) return;
    host.innerHTML = '';
    project.open.forEach(function (path) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab' + (path === project.active ? ' on' : '');
      var d = document.createElement('i');
      d.className = 'dot';
      var t = document.createElement('span');
      t.textContent = baseName(path);
      b.appendChild(d);
      b.appendChild(t);
      if (project.open.length > 1) {
        var x = document.createElement('span');
        x.className = 'x';
        x.textContent = '\u00d7';
        x.addEventListener('click', function (ev) {
          if (ev && ev.stopPropagation) ev.stopPropagation();
          closeFile(path);
        });
        b.appendChild(x);
      }
      b.addEventListener('click', function () { openFile(path); });
      host.appendChild(b);
    });
  }

  function openFile(path) {
    var f = fileOf(path);
    if (!f) return;
    var prev = fileOf(project.active);
    if (prev) prev.content = codeEl.value;
    if (project.open.indexOf(path) < 0) project.open.push(path);
    project.active = path;
    codeEl.value = f.content;
    if (!histMap[path]) histReset(path, f.content);
    codeEl.scrollTop = 0;
    errLine = 0;
    errFile = '';
    var cf = $('cur-file');
    if (cf) cf.textContent = path;
    refreshGutter();
    paintCode();
    updateCursor();
    renderTabs();
    renderTree();
    if (projTab === 'outline') renderOutline();
    flushSave();
  }

  function closeFile(path) {
    var i = project.open.indexOf(path);
    if (i < 0) return;
    project.open.splice(i, 1);
    if (project.active === path) {
      var next = project.open[i] || project.open[i - 1] || '';
      project.active = '';
      if (next) { openFile(next); return; }
      codeEl.value = '';
      refreshGutter();
      paintCode();
    }
    renderTabs();
    renderTree();
  }

  /* ---------------- 工程树 ---------------- */
  function countInGroup(g) { return g && g.files ? g.files.length : 0; }
  function countDirtyInGroup(g) {
    var n = 0;
    (g ? g.files : []).forEach(function (p) {
      var f = fileOf(p);
      if (f && f.dirty) n++;
    });
    return n;
  }

  function projRow(kind, path, label, depth, icon) {
    var row = document.createElement('div');
    row.className = 'p-row' + (kind === 'dir' ? ' dir' : '') +
      (kind === 'file' && path === project.active ? ' on' : '');
    row.style.paddingLeft = (5 + depth * 10) + 'px';
    row.setAttribute('title', label);
    var ic = document.createElement('span');
    ic.className = 'ico';
    ic.textContent = icon;
    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = label;
    var x = document.createElement('span');
    x.className = 'x';
    x.textContent = '\u00d7';
    row.appendChild(ic);
    row.appendChild(nm);
    row.appendChild(x);
    row.closeBtn = x;
    row.nameEl = nm;
    return row;
  }

  /* 把组里的文件按路径铺成层级树；组里暂时没有源码的空目录也挂进来 */
  function fileTreeOf(g) {
    var root = { dirs: {}, files: [] };
    function nodeOf(path) {
      var node = root;
      String(path).split('/').forEach(function (seg) {
        if (!seg) return;
        if (!node.dirs[seg]) node.dirs[seg] = { dirs: {}, files: [] };
        node = node.dirs[seg];
      });
      return node;
    }
    g.files.forEach(function (path) {
      var f = fileOf(path);
      if (f) nodeOf(dirName(path)).files.push(f);
    });
    (project.folders || []).forEach(function (fd) {
      var owner = (project.folderGroup || {})[fd] || (project.groups[0] && project.groups[0].name);
      if (owner === g.name) nodeOf(fd);
    });
    return root;
  }

  function renderTreeLevel(node, host, depth, prefix) {
    Object.keys(node.dirs).sort(cmpName).forEach(function (name) {
      var path = joinPath(prefix, name);
      var key = 'd:' + path;
      var open = !collapsed[key];
      var row = projRow('dir', key, name + '/', depth, open ? '\u25be' : '\u25b8');
      row.setAttribute('title', path + '/');
      row.addEventListener('click', function () { collapsed[key] = !!open; renderTree(); });
      row.addEventListener('dblclick', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        renameFolder(path);
      });
      row.closeBtn.title = '删除文件夹';
      row.closeBtn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        removeFolder(path);
      });
      host.appendChild(row);
      if (open) renderTreeLevel(node.dirs[name], host, depth + 1, path);
    });
    node.files.slice().sort(function (a, b) {
      return cmpName(baseName(a.path), baseName(b.path));
    }).forEach(function (f) { renderFileRow(f, host, depth); });
  }

  function renderFileRow(f, host, depth) {
    var path = f.path;
    var ext = (/\.([a-z0-9]+)$/i.exec(path) || [])[1];
    var frow = projRow('file', path, baseName(path), depth,
      /^h$/i.test(ext || '') ? 'H' : (/^c$/i.test(ext || '') ? 'C' : '\u00b7'));
    frow.setAttribute('draggable', 'true');
    frow.setAttribute('title', path);
    if (f.dirty) {
      var dd = document.createElement('span');
      dd.className = 'dirty';
      dd.title = '还没写回磁盘';
      frow.insertBefore(dd, frow.closeBtn);
    }
    frow.addEventListener('click', function () { openFile(path); });
    frow.addEventListener('dblclick', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      renameFile(path);
    });
    frow.addEventListener('dragstart', function (ev) {
      if (ev && ev.dataTransfer) {
        ev.dataTransfer.setData('text/plain', path);
        ev.dataTransfer.effectAllowed = 'move';
      }
    });
    frow.closeBtn.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      removeFile(path);
    });
    host.appendChild(frow);
  }

  function renderTree() {
    var host = $('proj-tree');
    if (!host) return;
    host.innerHTML = '';
    var pn = $('proj-name');
    if (pn) {
      pn.textContent = project.fs ? '工程' : (project.name || '工程');
      if (pn.parentNode && pn.parentNode.setAttribute) {
        pn.parentNode.setAttribute('title', project.fs ? '磁盘文件夹：' + FS.name : '工程：' + (project.name || ''));
      }
    }
    ensureGroups(project);

    var pOpen = !collapsed.p;
    var pRow = projRow('dir', 'p', 'Project: ' + (project.name || '工程'), 0, pOpen ? '\u25be' : '\u25b8');
    pRow.closeBtn.style.display = 'none';
    pRow.addEventListener('click', function () { collapsed.p = !!pOpen; renderTree(); });
    host.appendChild(pRow);
    if (!pOpen) return finish();

    var tOpen = !collapsed.t;
    var tRow = projRow('dir', 't', 'Target 1', 1, tOpen ? '\u25be' : '\u25b8');
    tRow.closeBtn.style.display = 'none';
    tRow.addEventListener('click', function () { collapsed.t = !!tOpen; renderTree(); });
    host.appendChild(tRow);
    if (!tOpen) return finish();

    project.groups.forEach(function (g) {
      var key = 'g:' + g.name;
      var open = !collapsed[key];
      var row = projRow('dir', key, g.name, 2, open ? '\u25be' : '\u25b8');
      var cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = String(countInGroup(g));
      row.insertBefore(cnt, row.closeBtn);
      if (countDirtyInGroup(g)) {
        var gd = document.createElement('span');
        gd.className = 'dirty';
        row.insertBefore(gd, row.closeBtn);
      }
      row.addEventListener('click', function () { collapsed[key] = !!open; renderTree(); });
      row.addEventListener('dblclick', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        renameGroup(g.name);
      });
      row.closeBtn.addEventListener('click', function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        removeGroup(g.name);
      });
      row.addEventListener('dragover', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
      });
      row.addEventListener('drop', function (ev) {
        if (!ev) return;
        ev.preventDefault();
        if (ev.stopPropagation) ev.stopPropagation();
        var path = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
        if (!path || !fileOf(path) || groupOf(path) === g) return;
        addToGroup(path, g.name);
        saveProject();
        renderTree();
        log('已把 ' + path + ' 移到「' + g.name + '」', 'dim');
      });
      host.appendChild(row);
      if (!open) return;
      renderTreeLevel(fileTreeOf(g), host, 3, '');
    });
    finish();

    function finish() {
      if (!project.files.length) {
        var e = document.createElement('div');
        e.className = 'proj-empty';
        e.textContent = '这个工程还是空的。点上面的「＋文件」新建 main.c，';
        var link = document.createElement('button');
        link.type = 'button';
        link.className = 'linky';
        link.textContent = '或载入一个多文件示例';
        link.addEventListener('click', function () { createDemo(); });
        e.appendChild(link);
        e.appendChild(document.createTextNode('。'));
        host.appendChild(e);
      }
    }
  }

  /* ---------------- 小对话框 ---------------- */
  var dlgEl = $('dlg'), dlgInput = $('dlg-input'), dlgTitle = $('dlg-title'), dlgMsg = $('dlg-msg');
  var dlgResolve = null, dlgKind = 'text';
  function closeDlg(val) {
    if (dlgEl && dlgEl.classList) dlgEl.classList.remove('on');
    var r = dlgResolve;
    dlgResolve = null;
    if (r) r(val);
  }
  function askModal(title, opts) {
    opts = opts || {};
    dlgKind = opts.input === false ? 'confirm' : 'text';
    if (dlgTitle) dlgTitle.textContent = title;
    if (dlgMsg) dlgMsg.textContent = opts.msg || '';
    if (dlgInput) {
      dlgInput.style.display = dlgKind === 'confirm' ? 'none' : '';
      dlgInput.value = opts.value || '';
    }
    var okBtn = $('dlg-ok');
    if (okBtn) okBtn.textContent = opts.ok || '确定';
    if (dlgEl && dlgEl.classList) dlgEl.classList.add('on');
    if (dlgKind !== 'confirm' && dlgInput && dlgInput.focus) {
      try { dlgInput.focus(); dlgInput.select(); } catch (e) {}
    }
    return new Promise(function (res) { dlgResolve = res; });
  }
  if ($('dlg-ok')) $('dlg-ok').onclick = function () {
    closeDlg(dlgKind === 'confirm' ? true : (dlgInput ? dlgInput.value : ''));
  };
  if ($('dlg-cancel')) $('dlg-cancel').onclick = function () {
    closeDlg(dlgKind === 'confirm' ? false : null);
  };
  if (dlgEl) dlgEl.addEventListener('click', function (e) {
    if (e && e.target === dlgEl) closeDlg(dlgKind === 'confirm' ? false : null);
  });
  if (dlgInput) dlgInput.addEventListener('keydown', function (e) {
    if (!e) return;
    if (e.key === 'Enter') { e.preventDefault(); closeDlg(dlgInput.value); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDlg(null); }
  });

  /* ---------------- 新建文件：先选类型，再填名字和分组 ---------------- */
  var ITEM_TYPES = [
    { ext: 'c', label: 'C 源文件（.c）', def: 'new.c' },
    { ext: 'h', label: '头文件（.h）', def: 'new.h' },
    { ext: 'txt', label: '文本文件（.txt）', def: 'note.txt' }
  ];
  var itemExt = 'c';

  function itemSkeleton(ext, path) {
    if (ext === 'h') {
      var g = baseName(path).replace(/[^A-Za-z0-9]/g, '_').toUpperCase() || 'HEADER_H';
      return '#ifndef ' + g + '\n#define ' + g + '\n\n/* 函数声明、宏、引脚定义放这里 */\n\n#endif\n';
    }
    if (ext === 'c') {
      /* 工程里还没有 main.c 时给一份能直接跑的骨架，否则只给空壳，
         免得每个 .c 都带一个 main 撞车 */
      if (!fileOf('main.c')) {
        return '#include <REGX52.H>\n\nvoid main()\n{\n    while(1)\n    {\n    }\n}\n';
      }
      return '#include <REGX52.H>\n\n\n';
    }
    return '';
  }
  function itemMsg(text) {
    var el = $('item-msg');
    if (el) el.textContent = text || '';
  }
  function setItemType(ext) {
    var t = ITEM_TYPES.filter(function (x) { return x.ext === ext; })[0] || ITEM_TYPES[0];
    itemExt = t.ext;
    if ($('item-type-name')) $('item-type-name').value = t.label;
    var nm = $('item-name');
    if (nm) nm.value = t.def;
    var list = $('item-types');
    if (list && list.children) {
      Array.prototype.forEach.call(list.children, function (li) {
        li.className = li.getAttribute('data-ext') === t.ext ? 'on' : '';
      });
    }
  }
  function openNewItem(groupName) {
    var el = $('dlg-new');
    if (!el) return;
    ensureGroups(project);
    var sel = $('item-group');
    if (sel) {
      sel.innerHTML = '';
      project.groups.forEach(function (g) {
        var o = document.createElement('option');
        o.value = g.name;
        o.textContent = g.name;
        sel.appendChild(o);
      });
      var cur = groupOf(project.active);
      sel.value = groupName || (cur ? cur.name : project.groups[0].name);
    }
    setItemType(itemExt || 'c');
    itemMsg('');
    el.classList.add('on');
    var nm = $('item-name');
    if (nm && nm.focus) { try { nm.focus(); nm.select(); } catch (e) {} }
  }
  function closeNewItem() {
    var el = $('dlg-new');
    if (el) el.classList.remove('on');
  }
  function submitNewItem() {
    var raw = $('item-name') ? String($('item-name').value || '').trim() : '';
    if (!raw) { itemMsg('请填文件名'); return; }
    var path = normPath(raw);
    var m = /\.[a-z0-9]+$/i.exec(path);
    if (!m) path += '.' + itemExt;
    else if (m[0].toLowerCase() !== '.' + itemExt) {
      path = path.slice(0, m.index) + '.' + itemExt;
    }
    if (fileOf(path)) { itemMsg('已经有同名文件：' + path); return; }
    var group = $('item-group') ? $('item-group').value : project.groups[0].name;
    closeNewItem();
    createFile(path, group, itemSkeleton(itemExt, path));
  }
  (function () {
    var list = $('item-types');
    if (list) list.addEventListener('click', function (e) {
      var n = e && e.target;
      while (n && n !== list && n.getAttribute && !n.getAttribute('data-ext')) n = n.parentNode;
      if (n && n !== list && n.getAttribute) setItemType(n.getAttribute('data-ext'));
    });
    if ($('item-cancel')) $('item-cancel').onclick = closeNewItem;
    if ($('item-ok')) $('item-ok').onclick = submitNewItem;
    var nm = $('item-name');
    if (nm) nm.addEventListener('keydown', function (e) {
      if (!e) return;
      if (e.key === 'Enter') { e.preventDefault(); submitNewItem(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeNewItem(); }
    });
    var mask = $('dlg-new');
    if (mask) mask.addEventListener('click', function (e) { if (e && e.target === mask) closeNewItem(); });
  })();

  /* ---------------- 快捷键一览 ---------------- */
  function openKeys() {
    var el = $('dlg-keys');
    if (el) { el.classList.add('on'); el.setAttribute('aria-hidden', 'false'); }
  }
  function closeKeys() {
    var el = $('dlg-keys');
    if (el) { el.classList.remove('on'); el.setAttribute('aria-hidden', 'true'); }
  }
  if ($('btn-keys')) $('btn-keys').onclick = openKeys;
  if ($('keys-close')) $('keys-close').onclick = closeKeys;
  (function () {
    var mask = $('dlg-keys');
    if (mask) mask.addEventListener('click', function (e) { if (e && e.target === mask) closeKeys(); });
  })();

  /* ---------------- IndexedDB：记住上次打开的文件夹 ---------------- */
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no idb')); return; }
      var req = window.indexedDB.open('c51lab', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('idb error')); };
    });
  }
  function idbSet(k, v) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k);
        t.oncomplete = function () { res(); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  function idbGet(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction('kv', 'readonly');
        var r = t.objectStore('kv').get(k);
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function idbDel(k) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').delete(k);
        t.oncomplete = function () { res(); };
      });
    });
  }

  /* ---------------- 磁盘：读 ---------------- */
  function scanDir(dir, prefix, out, depth) {
    return new Promise(function (resolve) {
      var it = dir.values();
      function step() {
        it.next().then(function (r) {
          if (r.done) { resolve(); return; }
          var entry = r.value;
          if (out.files.length >= LIMIT_FILES) { resolve(); return; }
          if (entry.kind === 'directory') {
            if (SKIP_DIRS[String(entry.name).toLowerCase()]) { step(); return; }
            var dp = joinPath(prefix, entry.name);
            out.folders.push(dp);
            if (depth >= MAX_DEPTH) { step(); return; }
            scanDir(entry, dp, out, depth + 1).then(step);
            return;
          }
          if (!TEXT_EXT.test(entry.name)) { step(); return; }
          entry.getFile().then(function (file) {
            if (out.bytes + file.size > 12 * 1024 * 1024) { step(); return; }
            return file.text().then(function (text) {
              out.bytes += file.size;
              out.files.push({
                path: joinPath(prefix, entry.name),
                content: text,
                handle: entry,
                dirty: false,
                size: file.size
              });
              step();
            });
          }).catch(function () { step(); });
        }).catch(function () { resolve(); });
      }
      step();
    });
  }

  function attachDir(dir) {
    if (FS.busy) return Promise.resolve();
    FS.busy = true;
    setStat('正在读取 ' + dir.name + ' …');
    var out = { files: [], folders: [], bytes: 0 };
    return scanDir(dir, '', out, 0).then(function () {
      FS.root = dir;
      FS.name = dir.name;
      FS.pending = null;
      project.fs = true;
      project.name = dir.name;
      project.files = out.files;
      project.folders = out.folders;
      ensureGroups(project);
      var keep = project.open.filter(function (p) {
        return out.files.some(function (f) { return f.path === p; });
      });
      project.open = keep.length ? keep : (out.files[0] ? [out.files[0].path] : []);
      project.active = keep.indexOf(project.active) >= 0 ? project.active : (project.open[0] || '');
      collapsed = {};
      codeEl.value = fileOf(project.active) ? fileOf(project.active).content : '';
      histMap = {};
      histReset(project.active, codeEl.value);
      loadBp();
      errLine = 0;
      errFile = '';
      renderTabs();
      renderTree();
      refreshGutter();
      paintCode();
      build();
      updateFsUi();
      FS.busy = false;
      try { idbSet(FS_DB_KEY, dir).catch(function () {}); } catch (e) {}
      log('已连接文件夹「' + dir.name + '」：读到 ' + out.files.length + ' 个文件、' + out.folders.length + ' 个目录。改动点「保存」或 Ctrl+S 写回磁盘。', 'ok');
      if (!out.files.length) {
        log('这个文件夹里没找到 .c / .h 之类的源码（Objects、Listings、.git 等目录会自动跳过）。', 'dim');
      }
    }).catch(function (e) {
      FS.busy = false;
      setStat('');
      log('读取文件夹失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function openFolder() {
    if (!FS.supported) {
      var inFrame = false;
      try { inFrame = window.self !== window.top; } catch (e) { inFrame = true; }
      log('这个环境不允许直接读写本地文件夹（需要 Edge / Chrome，而且不能在预览面板的 iframe 里）。'
        + (inFrame ? '请把 HTML 文件用 Edge 或 Chrome 直接打开再用；' : '')
        + '也可以用「导入」把文件拷进来，改完再「导出 zip」。', 'err');
      return;
    }
    if (FS.busy) return;
    if (FS.pending) { requestReconnect(); return; }
    var opts = { id: 'c51lab', mode: 'readwrite', startIn: 'documents' };
    window.showDirectoryPicker(opts).then(function (dir) {
      return attachDir(dir);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      var msg = e && e.message ? e.message : String(e);
      if ((e && e.name === 'SecurityError') || /cross origin|not allowed|permission/i.test(msg)) {
        msg += '（预览面板通常禁止弹出选择框，请用 Edge / Chrome 直接打开这个 HTML 文件再试）';
      }
      log('打开文件夹失败：' + msg, 'err');
    });
  }

  function requestReconnect() {
    var h = FS.pending;
    if (!h) { openFolder(); return; }
    h.requestPermission({ mode: 'readwrite' }).then(function (perm) {
      if (perm === 'granted') { FS.pending = null; return attachDir(h); }
      log('没有拿到读写权限，可以再点一次「重新连接」。', 'err');
    }).catch(function (e) {
      log('重新连接失败：' + (e && e.message ? e.message : e), 'err');
    });
  }

  function restoreDir() {
    if (!FS.supported) { updateFsUi(); return Promise.resolve(); }
    return idbGet(FS_DB_KEY).then(function (h) {
      if (!h) { updateFsUi(); return; }
      return h.queryPermission({ mode: 'readwrite' }).then(function (perm) {
        if (perm === 'granted') return attachDir(h);
        FS.pending = h;
        updateFsUi();
        log('上次打开的文件夹「' + h.name + '」还在，点左上角「重新连接 ' + h.name + '」继续编辑磁盘文件。', 'dim');
      });
    }).catch(function () { updateFsUi(); });
  }

  /* ---------------- 磁盘：写 ---------------- */
  function resolveDir(parts, create) {
    var p = Promise.resolve(FS.root);
    parts.forEach(function (seg) {
      p = p.then(function (h) { return h.getDirectoryHandle(seg, { create: !!create }); });
    });
    return p;
  }
  function writeHandle(handle, content) {
    return handle.createWritable().then(function (w) {
      return w.write(String(content)).then(function () { return w.close(); });
    });
  }
  function saveAll() {
    if (!project.fs) { log('当前是浏览器内工程，改动自动存在本机，不需要写盘。', 'dim'); return Promise.resolve(); }
    var list = project.files.filter(function (f) { return f.dirty; });
    if (!list.length) { log('没有需要保存的改动。', 'dim'); return Promise.resolve(); }
    var ok = 0, fail = [];
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        var cur = f.path === project.active ? codeEl.value : f.content;
        f.content = cur;
        if (!f.handle) { fail.push(f.path + '（无磁盘句柄）'); return; }
        return writeHandle(f.handle, cur).then(function () {
          f.dirty = false;
          ok++;
        }).catch(function () { fail.push(f.path); });
      });
    });
    return chain.then(function () {
      renderTabs();
      renderTree();
      updateFsUi();
      if (ok) log('已保存 ' + ok + ' 个文件到磁盘。', 'ok');
      if (fail.length) log('这些没写成功：' + fail.join('、'), 'err');
    });
  }

  function createDemo() {
    project = {
      name: '多文件示例',
      folders: [],
      open: ['main.c', 'led.h', 'led.c'],
      active: 'main.c',
      fs: false,
      files: [
        {
          path: 'main.c',
          content: '#include <REGX52.H>\n#include "delay.h"\n#include "led.h"\n\n'
            + 'void main()\n{\n    while(1)\n    {\n        LED_On();\n        Delay(300);\n'
            + '        LED_Off();\n        Delay(300);\n    }\n}\n'
        },
        {
          path: 'led.h',
          content: '#ifndef LED_H\n#define LED_H\n\n'
            + '/* 8 个 LED 接 P2，低电平点亮 */\nvoid LED_On(void);\nvoid LED_Off(void);\n\n#endif\n'
        },
        {
          path: 'led.c',
          content: '#include <REGX52.H>\n#include "led.h"\n\n'
            + 'void LED_On(void)\n{\n    P2 = 0xFE;   /* 只让 D1 亮 */\n}\n\n'
            + 'void LED_Off(void)\n{\n    P2 = 0xFF;   /* 全灭 */\n}\n'
        },
        {
          path: 'delay.h',
          content: '#ifndef DELAY_H\n#define DELAY_H\n\nvoid Delay(unsigned int xms);\n\n#endif\n'
        },
        {
          path: 'delay.c',
          content: '#include <REGX52.H>\n#include "delay.h"\n\n'
            + 'void Delay(unsigned int xms)\n{\n    unsigned char i, j;\n'
            + '    while (xms--)\n    {\n        i = 2;\n        j = 239;\n'
            + '        do { while (--j); } while (--i);\n    }\n}\n'
        }
      ]
    };
    ensureGroups(project);
    codeEl.value = fileOf('main.c').content;
    histMap = {};
    histReset('main.c', codeEl.value);
    renderTabs();
    renderTree();
    refreshGutter();
    paintCode();
    saveProject();
    build();
    updateFsUi();
    log('已生成多文件示例：main.c 调 led.c / delay.c，函数声明放在 .h 里。', 'ok');
  }

  /* ---------------- 增删改：磁盘模式会同步到磁盘 ---------------- */
  function addFolders(path) {
    var parts = String(path).split('/');
    parts.pop();
    var acc = '';
    parts.forEach(function (p) {
      acc = joinPath(acc, p);
      if (project.folders.indexOf(acc) < 0) project.folders.push(acc);
    });
  }
  function uniquePath(path) {
    if (!fileOf(path)) return path;
    var m = /^(.*?)(\.[^.]+)?$/.exec(path);
    for (var n = 2; n < 200; n++) {
      var p = m[1] + n + (m[2] || '');
      if (!fileOf(p)) return p;
    }
    return path + Date.now();
  }
  function templateFor(path) {
    if (/\.h$/i.test(path)) {
      var g = baseName(path).replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
      return '#ifndef ' + g + '\n#define ' + g + '\n\n/* 这里放函数声明、宏、引脚定义 */\n\n#endif\n';
    }
    return '#include <REGX52.H>\n\n\n';
  }
  function expand(path) {
    var d = dirName(path);
    while (d) {
      collapsed[d] = false;
      d = dirName(d);
    }
  }

  function createFile(rawPath, groupName, content) {
    var path = normPath(rawPath);
    if (!path) return;
    if (fileOf(path)) { log('已经有同名文件：' + path, 'err'); return; }
    content = content == null ? templateFor(path) : content;
    if (project.fs) {
      var parts = path.split('/');
      var name = parts.pop();
      resolveDir(parts, true).then(function (dir) {
        return dir.getFileHandle(name, { create: true });
      }).then(function (fh) {
        return writeHandle(fh, content).then(function () {
          project.files.push({ path: path, content: content, handle: fh, dirty: false });
          addToGroup(path, groupName || project.groups[0].name);
          addFolders(path);
          expand(path);
          openFile(path);
          build();
          updateFsUi();
          log('已在磁盘上创建 ' + FS.name + '/' + path, 'ok');
        });
      }).catch(function (e) {
        log('创建失败：' + (e && e.message ? e.message : e), 'err');
      });
      return;
    }
    project.files.push({ path: path, content: content, handle: null, dirty: false });
    addToGroup(path, groupName || project.groups[0].name);
    addFolders(path);
    expand(path);
    openFile(path);
    saveProject();
    build();
    updateFsUi();
    log('已新建 ' + path, 'ok');
  }

  function createFolder(rawPath, groupName) {
    var path = normPath(rawPath);
    if (!path) return;
    if (project.folders.indexOf(path) < 0) project.folders.push(path);
    if (!project.folderGroup) project.folderGroup = {};
    project.folderGroup[path] = groupName || (project.groups[0] && project.groups[0].name) || GROUP_DEFAULT;
    addFolders(path + '/x');
    collapsed[path] = false;
    renderTree();
    if (project.fs) {
      var parts = path.split('/');
      resolveDir(parts, true).then(function () {
        log('已在磁盘上创建目录 ' + path + '/', 'ok');
        renderTree();
      }).catch(function (e) {
        log('创建目录失败：' + (e && e.message ? e.message : e), 'err');
      });
      return;
    }
    saveProject();
    log('已新建文件夹 ' + path + '/', 'ok');
  }

  function createGroup() {
    var name = uniqueGroupName('Source Group');
    project.groups.push({ name: name, files: [] });
    collapsed['g:' + name] = false;
    saveProject();
    renderTree();
    log('已新建分组「' + name + '」', 'ok');
  }

  function renameGroup(oldName) {
    askModal('重命名分组', { msg: '只改显示名，不影响文件路径', value: oldName, ok: '改名' })
      .then(function (v) {
        var name = String(v == null ? '' : v).trim();
        if (!name || name === oldName) return;
        var dup = project.groups.some(function (g) { return g.name === name; });
        if (dup) { log('已经有同名分组：' + name, 'err'); return; }
        project.groups.forEach(function (g) { if (g.name === oldName) g.name = name; });
        if ('g:' + oldName in collapsed) {
          collapsed['g:' + name] = collapsed['g:' + oldName];
          delete collapsed['g:' + oldName];
        }
        saveProject();
        renderTree();
      });
  }

  function removeGroup(name) {
    if (project.groups.length <= 1) { log('至少要留一个分组', 'err'); return; }
    var idx = -1;
    project.groups.forEach(function (g, i) { if (g.name === name) idx = i; });
    if (idx < 0) return;
    var g = project.groups[idx];
    var target = project.groups[idx === 0 ? 1 : 0];
    askModal('删除分组', {
      msg: '删掉分组「' + name + '」？组里的 ' + g.files.length + ' 个文件会移到「'
        + target.name + '」，文件本身不会删除。',
      input: false, ok: '删除'
    }).then(function (yes) {
      if (!yes) return;
      g.files.forEach(function (p) { if (target.files.indexOf(p) < 0) target.files.push(p); });
      project.groups.splice(idx, 1);
      delete collapsed['g:' + name];
      saveProject();
      renderTree();
      log('已删除分组「' + name + '」', 'dim');
    });
  }

  function detachFile(path, nextActive) {
    project.files = project.files.filter(function (f) { return f.path !== path; });
    project.open = project.open.filter(function (p) { return p !== path; });
    removeFromGroups(path);
    delete collapsed[path];
    if (project.active === path) {
      project.active = '';
      if (nextActive) openFile(nextActive);
      else {
        var nx = project.open[0];
        if (nx) openFile(nx);
        else { codeEl.value = ''; refreshGutter(); paintCode(); }
      }
    }
    renderTabs();
    renderTree();
  }

  function removeFile(path) {
    askModal('删除文件', {
      msg: (project.fs ? '会把磁盘上的 ' : '把 ') + path + ' 删掉？这个操作不能撤销。',
      input: false, ok: '删除'
    }).then(function (yes) {
      if (!yes) return;
      var go = function () {
        detachFile(path);
        updateFsUi();
        build();
        log('已删除 ' + path, 'dim');
      };
      if (project.fs) {
        resolveDir(dirName(path).split('/').filter(Boolean), false)
          .then(function (dir) { return dir.removeEntry(baseName(path)); })
          .then(go)
          .catch(function (e) { log('删除失败：' + (e && e.message ? e.message : e), 'err'); });
        return;
      }
      go();
      saveProject();
    });
  }

  function removeFolder(path) {
    var inside = project.files.filter(function (f) { return f.path.indexOf(path + '/') === 0; });
    askModal('删除文件夹', {
      msg: '删除 ' + path + '/ 以及里面的 ' + inside.length + ' 个文件？' + (project.fs ? '磁盘上的目录也会被删除。' : ''),
      input: false, ok: '删除'
    }).then(function (yes) {
      if (!yes) return;
      var go = function () {
        project.files = project.files.filter(function (f) { return f.path.indexOf(path + '/') !== 0; });
        project.folders = project.folders.filter(function (f) { return f !== path && f.indexOf(path + '/') !== 0; });
        if (project.folderGroup) Object.keys(project.folderGroup).forEach(function (k) {
          if (k === path || k.indexOf(path + '/') === 0) delete project.folderGroup[k];
        });
        project.groups.forEach(function (g) {
          g.files = g.files.filter(function (p) { return p.indexOf(path + '/') !== 0; });
        });
        Object.keys(collapsed).forEach(function (k) {
          var raw = k.indexOf('d:') === 0 ? k.slice(2) : k;
          if (raw === path || raw.indexOf(path + '/') === 0) delete collapsed[k];
        });
        project.open = project.open.filter(function (p) {
          return project.files.some(function (f) { return f.path === p; });
        });
        if (!project.files.some(function (f) { return f.path === project.active; })) {
          var nx = project.open[0] || (project.files[0] && project.files[0].path);
          project.active = '';
          if (nx) openFile(nx);
          else { codeEl.value = ''; refreshGutter(); paintCode(); }
        }
        renderTabs();
        renderTree();
        updateFsUi();
        build();
        log('已删除文件夹 ' + path + '/', 'dim');
      };
      if (project.fs) {
        resolveDir(dirName(path).split('/').filter(Boolean), false)
          .then(function (dir) { return dir.removeEntry(baseName(path), { recursive: true }); })
          .then(go)
          .catch(function (e) { log('删除失败：' + (e && e.message ? e.message : e), 'err'); });
        return;
      }
      go();
      saveProject();
    });
  }

  function moveFileRecord(oldPath, newPath) {
    var f = fileOf(oldPath);
    if (!f) return;
    f.path = newPath;
    project.open = project.open.map(function (p) { return p === oldPath ? newPath : p; });
    if (project.active === oldPath) project.active = newPath;
    Object.keys(collapsed).forEach(function (k) {
      if (k === oldPath) { collapsed[newPath] = collapsed[k]; delete collapsed[k]; }
    });
    renameInGroups(oldPath, newPath);
    addFolders(newPath);
    expand(newPath);
  }

  function renameFile(path) {
    askModal('重命名文件', { msg: '可以顺便改目录，例如 driver/led.c', value: path, ok: '改名' })
      .then(function (v) {
        var np = normPath(v);
        if (!np || np === path) return;
        if (fileOf(np)) { log('已经有同名文件：' + np, 'err'); return; }
        var f = fileOf(path);
        if (!f) return;
        if (project.fs && f.handle) {
          var content = f.path === project.active ? codeEl.value : f.content;
          var parts = np.split('/');
          var name = parts.pop();
          resolveDir(parts, true).then(function (dir) {
            return dir.getFileHandle(name, { create: true });
          }).then(function (fh) {
            return writeHandle(fh, content).then(function () {
              return resolveDir(dirName(path).split('/').filter(Boolean), false)
                .then(function (dir) { return dir.removeEntry(baseName(path)); });
            }).then(function () {
              f.handle = fh;
              f.content = content;
              f.dirty = false;
              moveFileRecord(path, np);
              openFile(np);
              build();
              updateFsUi();
              log('已改名为 ' + np + '（磁盘同步）', 'ok');
            });
          }).catch(function (e) {
            log('改名失败：' + (e && e.message ? e.message : e), 'err');
          });
          return;
        }
        f.content = f.path === project.active ? codeEl.value : f.content;
        moveFileRecord(path, np);
        openFile(np);
        saveProject();
        build();
        updateFsUi();
      });
  }

  function renameFolder(path) {
    askModal('重命名文件夹', { msg: '里面的文件会一起改名', value: path, ok: '改名' })
      .then(function (v) {
        var np = normPath(v);
        if (!np || np === path) return;
        var inside = project.files.filter(function (f) { return f.path.indexOf(path + '/') === 0; });
        var remap = function (p) { return p.indexOf(path + '/') === 0 ? np + p.slice(path.length) : p; };
        var apply = function () {
          project.files.forEach(function (f) { f.path = remap(f.path); });
          project.folders = project.folders.map(function (fd) {
            return fd === path ? np : (fd.indexOf(path + '/') === 0 ? np + fd.slice(path.length) : fd);
          });
          if (project.folderGroup) {
            var nextGroup = {};
            Object.keys(project.folderGroup).forEach(function (k) {
              var nk = k === path ? np : (k.indexOf(path + '/') === 0 ? np + k.slice(path.length) : k);
              nextGroup[nk] = project.folderGroup[k];
            });
            project.folderGroup = nextGroup;
          }
          project.open = project.open.map(remap);
          if (project.active.indexOf(path + '/') === 0) project.active = remap(project.active);
          var nextCollapsed = {};
          Object.keys(collapsed).forEach(function (k) {
            var pre = k.indexOf('d:') === 0 ? 'd:' : '';
            var raw = pre ? k.slice(2) : k;
            var nk = raw === path ? np : (raw.indexOf(path + '/') === 0 ? np + raw.slice(path.length) : raw);
            nextCollapsed[pre + nk] = collapsed[k];
          });
          collapsed = nextCollapsed;
          addFolders(np + '/x');
          renderTabs();
          renderTree();
          updateFsUi();
          build();
          log('已改名为 ' + np + '/', 'ok');
        };
        if (project.fs && inside.length >= 0) {
          var chain = Promise.resolve();
          var moved = [];
          inside.forEach(function (f) {
            chain = chain.then(function () {
              var target = remap(f.path);
              var parts = target.split('/');
              var name = parts.pop();
              return resolveDir(parts, true).then(function (dir) {
                return dir.getFileHandle(name, { create: true });
              }).then(function (fh) {
                return writeHandle(fh, f.path === project.active ? codeEl.value : f.content).then(function () {
                  f.handle = fh;
                  f.dirty = false;
                  moved.push(f);
                });
              });
            });
          });
          chain.then(function () {
            return resolveDir(dirName(path).split('/').filter(Boolean), false)
              .then(function (dir) { return dir.removeEntry(baseName(path), { recursive: true }); });
          }).then(apply).catch(function (e) {
            log('文件夹改名失败：' + (e && e.message ? e.message : e), 'err');
          });
          return;
        }
        apply();
        saveProject();
      });
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function importHandles(handles) {
    if (!handles || !handles.length) return;
    var added = [];
    var chain = Promise.resolve();
    handles.forEach(function (h) {
      chain = chain.then(function () {
        return h.getFile().then(function (file) {
          return file.text().then(function (text) {
            var name = String(h.name || file.name || 'file.c');
            if (!TEXT_EXT.test(name)) return;
            var path = uniquePath(normPath(name));
            project.files.push({ path: path, content: text, handle: h, dirty: false });
            added.push(path);
          });
        });
      });
    });
    chain.then(function () {
      if (!added.length) { log('没有可导入的文本文件（支持 .c .h .inc .s .asm .txt 等）。', 'err'); return; }
      added.forEach(function (p) { addToGroup(p, project.groups[0].name); });
      added.forEach(addFolders);
      expand(added[0]);
      openFile(added[0]);
      renderTabs();
      renderTree();
      build();
      updateFsUi();
      log('已导入 ' + added.length + ' 个文件：' + added.join('、') + (project.fs ? '（保存会写回原文件）' : ''), 'ok');
    });
  }

  function importFiles(list) {
    var arr = [];
    for (var i = 0; i < (list ? list.length : 0); i++) arr.push(list[i]);
    if (!arr.length) return;
    var done = 0, added = [];
    function after() {
      if (!added.length) { log('没有读取到任何文件。', 'err'); return; }
      added.forEach(function (p) { addToGroup(p, project.groups[0].name); });
      added.forEach(addFolders);
      expand(added[0]);
      openFile(added[0]);
      renderTabs();
      renderTree();
      build();
      updateFsUi();
      log('已导入 ' + added.length + ' 个文件：' + added.join('、')
        + (project.fs ? '（这些是拷贝，保存只会写进内存副本）' : ''), 'ok');
    }
    arr.forEach(function (f) {
      var rd = new FileReader();
      rd.onload = function () {
        var name = String(f.name || 'file.c').replace(/[\\/]/g, '_');
        if (!TEXT_EXT.test(name)) { if (++done === arr.length) after(); return; }
        var path = uniquePath(normPath(name));
        project.files.push({ path: path, content: String(rd.result == null ? '' : rd.result), handle: null, dirty: !!project.fs });
        added.push(path);
        if (++done === arr.length) after();
      };
      rd.onerror = function () { if (++done === arr.length) after(); };
      rd.readAsText(f, 'utf-8');
    });
  }

  function pickImport() {
    if (FS.supported && window.showOpenFilePicker) {
      window.showOpenFilePicker({
        multiple: true,
        types: [{
          description: 'C 源文件',
          accept: { 'text/plain': ['.c', '.h', '.inc', '.s', '.asm', '.txt'] }
        }]
      }).then(function (hs) { return importHandles(hs); })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return;
          log('选择文件失败：' + (e && e.message ? e.message : e), 'err');
        });
      return;
    }
    var inp = $('file-input');
    if (inp) inp.click();
  }

  var CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Int32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c;
      }
    }
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }
  /* 只用「存储」方式的 zip：几十行就能生成，解压工具和 Keil 都能读 */
  function zipBlob(entries) {
    var enc = new TextEncoder();
    var d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var parts = [], central = [], offset = 0;
    entries.forEach(function (e) {
      var name = enc.encode(e.name), data = enc.encode(e.content);
      var crc = crc32(data);
      var lh = new Uint8Array(30 + name.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true);
      lh.set(name, 30);
      parts.push(lh, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += lh.length + data.length;
    });
    var cd = [], cdLen = 0;
    central.forEach(function (c) {
      var h = new Uint8Array(46 + c.name.length);
      var dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true);
      dv.setUint16(12, dosTime, true);
      dv.setUint16(14, dosDate, true);
      dv.setUint32(16, c.crc, true);
      dv.setUint32(20, c.size, true);
      dv.setUint32(24, c.size, true);
      dv.setUint16(28, c.name.length, true);
      dv.setUint32(42, c.offset, true);
      h.set(c.name, 46);
      cd.push(h);
      cdLen += h.length;
    });
    var end = new Uint8Array(22);
    var edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, central.length, true);
    edv.setUint16(10, central.length, true);
    edv.setUint32(12, cdLen, true);
    edv.setUint32(16, offset, true);
    return new Blob(parts.concat(cd, [end]), { type: 'application/zip' });
  }
  function exportZip() {
    try {
      var entries = project.files.map(function (f) {
        return { name: f.path, content: f.path === project.active ? codeEl.value : f.content };
      });
      if (!entries.length) { log('工程是空的，没有可导出的文件。', 'err'); return; }
      var blob = zipBlob(entries);
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = String(project.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.zip';
      if (document.body) document.body.appendChild(a);
      a.click();
      if (document.body && a.parentNode) document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
      log('已导出 ' + entries.length + ' 个文件（zip，可直接解压后用 Keil 打开）。', 'ok');
    } catch (e) {
      log('导出失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  /* ---------------- 工程文件（JSON）：存下来、换台电脑再打开 ---------------- */
  function projectData() {
    var cur = fileOf(project.active);
    if (cur) cur.content = codeEl.value;
    return {
      format: 'c51lab-project',
      version: 1,
      savedAt: new Date().toISOString(),
      name: project.name || '工程',
      files: project.files.map(function (f) {
        return { path: f.path, content: String(f.content == null ? '' : f.content) };
      }),
      groups: project.groups.map(function (g) { return { name: g.name, files: g.files.slice() }; }),
      open: project.open.slice(),
      active: project.active
    };
  }

  function exportProjectFile() {
    var data = projectData();
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = String(project.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.c51proj.json';
      if (document.body) document.body.appendChild(a);
      a.click();
      if (document.body && a.parentNode) document.body.removeChild(a);
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
      log('已存工程文件：' + a.download + '（' + project.files.length + ' 个文件）', 'ok');
    } catch (e) {
      log('存工程失败：' + (e && e.message ? e.message : e), 'err');
    }
  }

  function importProjectFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var data;
      try {
        data = JSON.parse(String(rd.result == null ? '' : rd.result));
      } catch (e) {
        log('工程文件不是合法的 JSON。', 'err');
        return;
      }
      if (!data || data.format !== 'c51lab-project' || !Array.isArray(data.files) || !data.files.length) {
        log('这不是本工具导出的工程文件。', 'err');
        return;
      }
      askModal('打开工程', {
        msg: '会替换当前工程（现在有 ' + project.files.length + ' 个文件），没存过的改动会丢。继续？',
        input: false, ok: '打开'
      }).then(function (yes) {
        if (!yes) return;
        applyProjectData(data);
      });
    };
    rd.onerror = function () { log('读取工程文件失败。', 'err'); };
    rd.readAsText(file, 'utf-8');
  }

  /* 把工程 JSON 应用到当前工作区：开工程文件、恢复快照共用 */
  function applyProjectData(data) {
    project = {
      name: data.name || '导入的工程',
      files: data.files.filter(function (f) { return f && f.path; }).map(function (f) {
        return {
          path: normPath(f.path),
          content: String(f.content == null ? '' : f.content),
          handle: null, dirty: false
        };
      }),
      folders: [],
      groups: Array.isArray(data.groups) ? data.groups : [],
      open: [], active: '', fs: false
    };
    ensureGroups(project);
    project.open = (data.open || []).filter(function (p) { return !!fileOf(p); });
    if (!project.open.length) project.open = [project.files[0].path];
    project.active = fileOf(data.active) ? data.active : project.open[0];
    curExample = null;
    histMap = {};
    codeEl.value = fileOf(project.active).content;
    histReset(project.active, codeEl.value);
    loadBp();
    renderTabs();
    renderTree();
    refreshGutter();
    paintCode();
    updateFsUi();
    saveProject();
    build();
    log('已打开工程「' + project.name + '」，' + project.files.length
      + ' 个文件，' + project.groups.length + ' 个分组', 'ok');
  }

  /* ---------------- 工程快照：存到 localStorage，随时恢复 ---------------- */
  var SNAP_KEY = 'c51.snapshots';
  function snapAll() {
    try {
      var arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function snapWrite(arr) {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(arr)); return true; }
    catch (e) { log('快照保存失败：浏览器存储空间不足，可以先删掉几个旧快照。', 'err'); return false; }
  }
  function snapOpen() {
    var m = $('dlg-snap');
    if (!m) return;
    m.classList.add('on');
    m.setAttribute('aria-hidden', 'false');
    snapRender();
  }
  function snapClose() {
    var m = $('dlg-snap');
    if (!m) return;
    m.classList.remove('on');
    m.setAttribute('aria-hidden', 'true');
  }
  function snapRender() {
    var host = $('snap-list');
    if (!host) return;
    var arr = snapAll();
    if (!arr.length) {
      host.innerHTML = '<div class="snap-empty">还没有快照。在上面输入名字，点「保存当前工程」。</div>';
      return;
    }
    host.innerHTML = '';
    arr.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'snap-row';
      var meta = document.createElement('div');
      meta.className = 'snap-meta';
      var nm = document.createElement('span');
      nm.className = 'snap-name';
      nm.textContent = s.name || ('快照 ' + (i + 1));
      var tm = document.createElement('span');
      tm.className = 'snap-time';
      tm.textContent = (s.time || '') + ' · ' + (s.data && s.data.files ? s.data.files.length : 0) + ' 个文件';
      meta.appendChild(nm);
      meta.appendChild(tm);
      var open = document.createElement('button');
      open.type = 'button';
      open.textContent = '恢复';
      open.onclick = function () {
        askModal('恢复快照', {
          msg: '会用快照「' + (s.name || '') + '」替换当前工程，没存过的改动会丢。继续？',
          input: false, ok: '恢复'
        }).then(function (yes) {
          if (!yes) return;
          applyProjectData(s.data);
          snapClose();
        });
      };
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'ghost';
      del.textContent = '删除';
      del.onclick = function () {
        var arr2 = snapAll();
        arr2.splice(i, 1);
        snapWrite(arr2);
        snapRender();
      };
      row.appendChild(meta);
      row.appendChild(open);
      row.appendChild(del);
      host.appendChild(row);
    });
  }
  function snapSave() {
    var input = $('snap-name');
    var name = input && input.value.trim() ? input.value.trim() : (project.name || '工程') + ' 快照';
    var arr = snapAll();
    arr.unshift({
      name: name,
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      data: projectData()
    });
    if (arr.length > 8) arr.length = 8;
    if (!snapWrite(arr)) return;
    if (input) input.value = '';
    snapRender();
    log('已保存快照「' + name + '」（共 ' + arr.length + ' 个）', 'ok');
  }
  if ($('btn-snap')) $('btn-snap').onclick = snapOpen;
  if ($('snap-save')) $('snap-save').onclick = snapSave;
  if ($('snap-close')) $('snap-close').onclick = snapClose;
  var snapMask = $('dlg-snap');
  if (snapMask) snapMask.addEventListener('click', function (e) { if (e.target === snapMask) snapClose(); });
  if ($('snap-name')) $('snap-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); snapSave(); }
  });

  /* ---------------- 实验报告导出（Markdown）：代码 + 诊断 + 运行状态 ---------------- */
  $('btn-report').onclick = function () {
    var cur = fileOf(project.active);
    if (cur) cur.content = codeEl.value;
    var lines = [];
    lines.push('# 51 单片机实验报告');
    lines.push('');
    lines.push('- 工程名称：' + project.name);
    lines.push('- 导出时间：' + new Date().toLocaleString());
    lines.push('- 文件数量：' + project.files.length);
    lines.push('');
    lines.push('## 一、实验代码');
    project.files.forEach(function (f) {
      lines.push('');
      lines.push('### ' + f.path);
      lines.push('```c');
      lines.push(f.content);
      lines.push('```');
    });
    lines.push('');
    lines.push('## 二、编译与诊断');
    lines.push('```');
    lines.push($('problems') ? $('problems').innerText.trim() : '没有发现问题。');
    lines.push('```');
    lines.push('');
    lines.push('## 三、运行观察');
    if (vm) {
      ['P0', 'P1', 'P2', 'P3'].forEach(function (p) {
        var bits = portBits[p] || [];
        var value = 0;
        var bin = '';
        for (var b = 0; b < 8; b++) {
          var bit = bits[b] && bits[b].textContent === '1' ? 1 : 0;
          value |= bit << b;
          bin = bit + bin;
        }
        lines.push('- 端口 ' + p + '：0b' + bin + '（0x' + value.toString(16).toUpperCase().padStart(2, '0') + '）');
      });
      lines.push('- 寄存器：' + ($('sfr') ? $('sfr').innerText.replace(/\s*\n\s*/g, '；') : ''));
      lines.push('- 虚拟时间：' + vm.vtime.toFixed(0) + ' ms；已执行语句：' + vm.stepCount + ' 条');
    } else {
      lines.push('（还没运行过。先点「运行」再导出，这里就会有端口、寄存器和虚拟时间。）');
    }
    lines.push('');
    lines.push('### 控制台记录（最近 30 条）');
    lines.push('```');
    var logLines = consoleEl ? consoleEl.innerText.trim().split('\n').slice(-30) : [];
    logLines.forEach(function (l) { lines.push(l); });
    lines.push('```');
    lines.push('');
    lines.push('## 四、实验总结（请自行补充）');
    lines.push('');
    lines.push('在这里写：实验目的、观察到的现象、遇到的问题和解决思路。');
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = project.name.replace(/[\\/:*?"<>|]/g, '_') + '-实验报告.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    log('实验报告已导出（Markdown，含代码、诊断和运行状态），总结部分记得自己补。', 'ok');
  };

  /* ---------------- 浅色 / 深色主题 ---------------- */
  function setTheme(light) {
    try {
      if (light) document.documentElement.classList.add('light');
      else document.documentElement.classList.remove('light');
      localStorage.setItem('c51.theme', light ? 'light' : 'dark');
    } catch (e) { /* 忽略 */ }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f4f6f9' : '#14161b');
  }
  if ($('btn-theme')) $('btn-theme').onclick = function () {
    var light = !document.documentElement.classList.contains('light');
    setTheme(light);
    log(light ? '已切到浅色主题，再点一次回到深色' : '已切到深色主题', 'dim');
  };

  /* ---------------- PWA：http(s) 下注册 Service Worker，断网也能打开 ---------------- */
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存不可用时静默 */ });
    });
  }

  /* ---------------- 状态栏 / 工程树开关 ---------------- */
  function setStat(text) {
    var el = $('proj-stat-text');
    if (el) el.textContent = text || '';
  }
  function renderStat() {
    var n = dirtyCount();
    if (project.fs) {
      setStat('磁盘 · ' + FS.name + (n ? ' · ' + n + ' 个未保存' : ' · 已保存'));
    } else if (FS.pending) {
      setStat('上次的文件夹：' + FS.pending.name);
    } else {
      setStat('浏览器内工程 · 不写盘');
    }
  }
  function updateFsDot() {
    var dot = $('fs-dot');
    if (!dot || !dot.classList) return;
    var n = dirtyCount();
    dot.className = 'fs-dot' + (project.fs ? ' on' : '') + (n ? ' dirty' : '');
    if (dot.setAttribute) {
      dot.setAttribute('title', project.fs
        ? (n ? '已连接 ' + FS.name + '，有 ' + n + ' 个文件还没写回磁盘' : '已连接 ' + FS.name + '，改动都已写盘')
        : '还没连接电脑上的文件夹');
    }
  }
  function updateFsUi() {
    var on = !!project.fs;
    var label = $('btn-open-dir-label');
    if (label) label.textContent = on ? FS.name : (FS.pending ? '重新连接 ' + FS.pending.name : '打开文件夹');
    var ob = $('btn-open-dir');
    if (ob && ob.setAttribute) {
      ob.setAttribute('title', on
        ? '当前连着 ' + FS.name + '，点这里换一个文件夹'
        : '选择电脑上的文件夹，直接读写里面的真实文件');
    }
    var save = $('btn-save');
    if (save) {
      save.hidden = !on;
      var n = dirtyCount();
      save.textContent = n ? '保存 ' + n : '保存';
    }
    var rf = $('btn-refresh');
    if (rf) rf.hidden = !on;
    var cd = $('btn-close-dir');
    if (cd) cd.hidden = !on && !FS.pending;
    if (cd && FS.pending && !on) cd.textContent = '忘记';
    var sel = $('ex-select');
    if (sel) {
      sel.disabled = on;
      if (sel.parentNode && sel.parentNode.setAttribute) {
        sel.parentNode.setAttribute('title', on ? '已连接磁盘文件夹，先「断开」才能载入讲义例程' : '从讲义载入例程');
      }
    }
    updateFsDot();
    renderStat();
  }

  function applyTree(on) {
    var panel = $('editor-panel') || (document.querySelector && document.querySelector('.editor-panel'));
    if (panel && panel.classList) {
      if (on) panel.classList.remove('tree-off'); else panel.classList.add('tree-off');
    }
    var page = $('page-code');
    if (page && page.classList) {
      if (on) page.classList.remove('tree-off'); else page.classList.add('tree-off');
    }
    var b = $('btn-tree');
    if (b && b.classList) {
      if (on) b.classList.add('on'); else b.classList.remove('on');
    }
    try { window.localStorage.setItem(TREE_KEY, on ? '1' : '0'); } catch (e) {}
  }
  (function () {
    var on = true;
    try { on = window.localStorage.getItem(TREE_KEY) !== '0'; } catch (e) {}
    applyTree(on);
  })();
  if ($('btn-tree')) $('btn-tree').onclick = function () {
    var panel = $('editor-panel') || (document.querySelector && document.querySelector('.editor-panel'));
    applyTree(!!(panel && panel.classList && panel.classList.contains && panel.classList.contains('tree-off')));
  };

  /* ---------------- 按钮 ---------------- */
  if ($('btn-open-dir')) $('btn-open-dir').onclick = function () { openFolder(); };
  if ($('btn-save')) $('btn-save').onclick = function () { saveAll(); };
  if ($('btn-refresh')) $('btn-refresh').onclick = function () {
    if (!project.fs) return;
    var n = dirtyCount();
    var go = function () { attachDir(FS.root); };
    if (n) {
      askModal('重新读取磁盘', {
        msg: '有 ' + n + ' 个文件还没保存，重新读取会丢掉这些改动。继续？',
        input: false, ok: '仍然读取'
      }).then(function (yes) { if (yes) go(); });
      return;
    }
    go();
  };
  if ($('btn-close-dir')) $('btn-close-dir').onclick = function () {
    if (FS.pending && !project.fs) {
      FS.pending = null;
      updateFsUi();
      log('已忘记上次的文件夹。', 'dim');
      return;
    }
    disconnectFS();
  };

  function disconnectFS() {
    var n = dirtyCount();
    var go = function () {
      FS.root = null;
      FS.name = '';
      FS.pending = null;
      project.fs = false;
      try { idbDel(FS_DB_KEY).catch(function () {}); } catch (e) {}
      loadExample(curExample ? curExample.id : 'led-on');
      updateFsUi();
      log('已断开磁盘文件夹，回到浏览器内工程（磁盘上的文件没动）。', 'dim');
    };
    if (n) {
      askModal('断开文件夹', {
        msg: '还有 ' + n + ' 个文件没保存到磁盘，断开就丢了。继续？',
        input: false, ok: '断开'
      }).then(function (yes) { if (yes) go(); });
      return;
    }
    go();
  }

  if ($('btn-new-file')) $('btn-new-file').onclick = function () { openNewItem(); };
  if ($('btn-new-folder')) $('btn-new-folder').onclick = function () {
    if (project.fs && !project.groups.length) return;
    var g = groupOf(project.active) || project.groups[0];
    askModal('新建文件夹', {
      msg: '建在当前分组里；可以写多级，如 driver/led',
      value: 'src', ok: '新建'
    }).then(function (v) {
      var p = normPath(v);
      if (!p) return;
      if (project.folders.indexOf(p) >= 0) { log('已经有同名文件夹：' + p + '/', 'err'); return; }
      createFolder(p, g ? g.name : '');
    });
  };
  if ($('btn-new-group')) $('btn-new-group').onclick = function () { createGroup(); };
  if ($('btn-import')) $('btn-import').onclick = function () { pickImport(); };
  if ($('file-input')) $('file-input').onchange = function () {
    importFiles(this.files);
    this.value = '';
  };
  if ($('btn-export')) $('btn-export').onclick = function () { exportZip(); };
  if ($('btn-save-proj')) $('btn-save-proj').onclick = function () { exportProjectFile(); };
  if ($('btn-load-proj')) $('btn-load-proj').onclick = function () {
    var inp = $('proj-input');
    if (inp) inp.click();
  };
  if ($('proj-input')) $('proj-input').onchange = function () {
    importProjectFile(this.files && this.files[0]);
    this.value = '';
  };

  (function () {
    var tree = $('proj-tree');
    if (!tree || !tree.addEventListener) return;
    ['dragenter', 'dragover'].forEach(function (ev) {
      tree.addEventListener(ev, function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (tree.classList) tree.classList.add('drop');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      tree.addEventListener(ev, function (e) {
        if (e && e.preventDefault) e.preventDefault();
        if (tree.classList) tree.classList.remove('drop');
      });
    });
    tree.addEventListener('drop', function (e) {
      if (e && e.dataTransfer && e.dataTransfer.files) importFiles(e.dataTransfer.files);
    });
  })();

  /* 离开页面前提醒还没保存的改动 */
  window.addEventListener('beforeunload', function (e) {
    flushSave();
    if (project.fs && dirtyCount()) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  function loadExample(id) {
    var ex = window.EXAMPLES.filter(function (e) { return e.id === id; })[0];
    if (!ex) return;
    if (project.fs) {
      log('现在连接着磁盘文件夹「' + FS.name + '」。要载入讲义例程，先点工程树上的「断开」。', 'err');
      var sel0 = $('ex-select');
      if (sel0) sel0.value = curExample ? curExample.id : id;
      return;
    }
    curExample = ex;
    state = 'stopped';
    var saved = readProject(id);
    var mine = loadSaved(id);
    if (saved) {
      project = saved;
    } else {
      project = {
        name: ex.title,
        files: [{ path: 'main.c', content: mine == null ? ex.code : mine, handle: null, dirty: false }],
        folders: [], open: ['main.c'], active: 'main.c', fs: false
      };
    }
    if (!project.name) project.name = ex.title;
    ensureGroups(project);
    codeEl.value = fileOf(project.active) ? fileOf(project.active).content : '';
    histMap = {};
    histReset(project.active, codeEl.value);
    loadBp();
    var cf0 = $('cur-file');
    if (cf0) cf0.textContent = project.active;
    renderTabs();
    renderTree();
    $('ex-chapter').textContent = ex.chapter;
    $('ex-goal').textContent = '预期现象：' + ex.goal;
    $('ex-points').innerHTML = ex.points.map(function (p) { return '<li>' + p + '</li>'; }).join('');
    $('ex-quiz').innerHTML = ex.quiz.map(function (p) { return '<li>' + p + '</li>'; }).join('');
    $('quiz-wrap').style.display = ex.quiz.length ? '' : 'none';
    /* 讲义页底部始终显示这一节的原始代码，编辑器里可以是你改过的版本 */
    var ec = $('ex-code');
    if (ec) ec.textContent = ex.code;
    Array.prototype.forEach.call(document.querySelectorAll('.ex-btn'), function (b) {
      b.classList.toggle('active', b.dataset.id === id);
    });
    var sel = $('ex-select');
    if (sel) sel.value = id;
    codeEl.scrollTop = 0;
    errLine = 0;
    errFile = '';
    refreshGutter();
    paintCode();
    build();
    if (saved) {
      log('已打开工程「' + (project.name || ex.title) + '」（' + project.files.length + ' 个文件），上次的改动都还在。', 'dim');
    } else if (mine != null) {
      log('已加载例程「' + ex.title + '」，并恢复了你上次改过的代码（点"还原"可回到讲义原版）。', 'dim');
    } else {
      log('已加载例程「' + ex.title + '」，点"运行"开始。', 'dim');
    }
    updateButtons();
    updateFade();
  }

  /* 每个例程的改动自动存在本机浏览器里，关掉页面也不会丢 */
  function loadSaved(id) {
    try {
      var v = window.localStorage.getItem('c51lab.code.v2.' + id);
      return v == null ? null : v;
    } catch (e) { return null; }
  }
  /* 打字时不必每个字都序列化整个工程，攒 300ms 再写一次 */
  var saveTimer = null;
  function saveProjectSoon() {
    if (project.fs) { saveProject(); return; }
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveProject();
    }, 300);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveProject(); }
  }
  function saveCode() {
    if (!curExample) return;
    saveProjectSoon();
  }

  /* ---------------- 左栏可滚动区：还有内容时底部渐隐 ---------------- */
  function updateFade() {
    var el = $('notes-scroll');
    if (!el || !el.classList) return;
    var more = (el.scrollHeight || 0) - (el.scrollTop || 0) - (el.clientHeight || 0) > 2;
    el.classList.toggle('fade', more);
  }
  (function () {
    var el = $('notes-scroll');
    if (el && el.addEventListener) el.addEventListener('scroll', updateFade);
    window.addEventListener('resize', updateFade);
  })();

  /* ---------------- 06 时序图（逻辑分析仪） ----------------
     数据来自 hw.trace：每次电平真的变化才记一条 {t, port, v}。
     默认「全程」：从本次运行 0ms 一直画到当前/结束时刻，这次跑过的所有变化都在图上。
     200ms / 1s / 5s 是以当前时刻为右端的局部放大，用来看密集扫描的细节。
     横轴是虚拟时间；build() 会重建硬件对象，波形随新一次运行自动清空。
  ------------------------------------------------------------------ */
  var scopeCanvas = $('scope');
  var scopeScroll = $('scope-scroll'), scopeSpacer = $('scope-spacer');
  var scopeSpan = 0;                 /* 0 = 全程 */
  var scopeZoom = 0;                 /* 横向缩放：0 = 适应窗口，>0 = 每毫秒多少像素 */
  var PORT_ORDER = ['P0', 'P1', 'P2', 'P3'];
  var scopeView = null;              /* 最近一次绘制的几何与数据，供鼠标交互换算 */
  var scopeHoverT = null;
  var scopeCursorA = null, scopeCursorB = null;
  var hasUserDelay = false;          /* 用户自定义了 Delay()，但被内置加速版覆盖 */

  /* 不替用户改视图，只更新提示文字；变化特别密时建议切局部窗口 */
  function autoSpan() {
    syncSpanButtons();
    var hint = $('scope-hint');
    if (!hint) return;
    var txt;
    if (scopeSpan !== 0) {
      txt = '最近 ' + fmtMs(scopeSpan) + ' 的局部放大 · 点「全程」看整次运行';
    } else {
      var tr = (hw && hw.trace) || [];
      var now = vm ? vm.vtime : 0;
      txt = (tr.length && now > 50 && tr.length / now > 0.12)
        ? '整次运行完整波形 · 密集处点 200ms 看细节 · 点击图放光标量时间'
        : '整次运行完整波形 · 点击图放光标量时间 · 可导出 PNG / CSV';
    }
    if (hint.textContent !== txt) hint.textContent = txt;
  }

  function syncSpanButtons() {
    var segEl = $('scope-span');
    if (!segEl || !segEl.querySelectorAll) return;
    var btns = segEl.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var ms = parseInt(btns[i].dataset && btns[i].dataset.ms, 10);
      if (btns[i].classList) btns[i].classList.toggle('on', ms === scopeSpan);
    }
  }

  function fmtMs(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 's';
    return Math.round(v) + 'ms';
  }

  function updateScopeInfo(now, changes, lanes) {
    var el = $('scope-info');
    if (!el) return;
    var view = scopeSpan === 0 ? '全程 0 → ' + fmtMs(now) : '最近 ' + fmtMs(scopeSpan);
    el.textContent = view + ' · 电平变化 ' + changes + ' 条 · 引脚线 ' + lanes + ' 条'
      + (scopeZoom > 0 ? ' · 横向 ' + scopeZoom + 'px/ms（拖下方滚动条看）' : '')
      + (hw && hw.traceCompacted ? ' · 密集段已抽稀' : '')
      + (state === 'running' ? ' · 记录中' : ' · 本次运行已结束')
      + (scopeCursorA != null && scopeCursorB != null
          ? ' · 光标 A→B ' + fmtMs(Math.abs(scopeCursorB - scopeCursorA)) : '')
      + (scopeCursorA != null && scopeCursorB == null ? ' · 已放 A 光标（再点一下放 B）' : '');
  }

  /* 某一时刻某端口的字节值：在该端口的有序记录里二分找最后一条 <= t */
  function scopeValueByte(port, t) {
    if (!scopeView) return 255;
    var arr = scopeView.seg[port] || [];
    var lo = 0, hi = arr.length - 1, v = scopeView.start[port];
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid].t <= t) { v = arr[mid].v; lo = mid + 1; }
      else hi = mid - 1;
    }
    return v;
  }
  /* 波形区专用：取值可能是 undefined，先兜成 0 再格式化成两位十六进制 */
  function hex2Byte(v) { return '0x' + ('0' + (v & 0xFF).toString(16).toUpperCase()).slice(-2); }

  /* 悬停竖线与端口读数、A/B 光标与 Δt，全部画在波形之上 */
  function drawScopeOverlay(ctx, W, H) {
    var v = scopeView;
    if (!v) return;
    function xAt(t) { return v.padL + (t - v.t0) / v.dur * v.plotW; }
    function line(t, color, dash) {
      var x = xAt(t);
      if (x < v.padL || x > v.padL + v.plotW) return;
      if (ctx.save) ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      if (dash && ctx.setLineDash) ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x + 0.5, 6); ctx.lineTo(x + 0.5, H - 16); ctx.stroke();
      if (dash && ctx.setLineDash) ctx.setLineDash([]);
      if (ctx.restore) ctx.restore();
    }
    function tag(x, y, text, color) {
      ctx.font = '10px "Cascadia Mono", Consolas, monospace';
      var w = ctx.measureText ? ctx.measureText(text).width : text.length * 6;
      var bx = Math.max(2, Math.min(W - w - 10, x + 5));
      ctx.fillStyle = 'rgba(20, 22, 27, .88)';
      if (ctx.fillRect) ctx.fillRect(bx - 3, y - 10, w + 8, 15);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(text, bx, y + 1);
    }
    if (scopeCursorA != null) line(scopeCursorA, 'rgba(120, 200, 255, .9)', false);
    if (scopeCursorB != null) line(scopeCursorB, 'rgba(240, 190, 100, .9)', false);
    if (scopeCursorA != null && scopeCursorB != null) {
      tag((xAt(scopeCursorA) + xAt(scopeCursorB)) / 2, 18,
        'Δt ' + fmtMs(Math.abs(scopeCursorB - scopeCursorA)), '#f0be64');
    } else if (scopeCursorA != null) {
      tag(xAt(scopeCursorA), 18, 'A ' + fmtMs(scopeCursorA), '#78c8ff');
    }
    if (scopeHoverT != null) {
      line(scopeHoverT, 'rgba(246, 241, 234, .45)', true);
      var s = 't ' + fmtMs(scopeHoverT);
      for (var i = 0; i < PORT_ORDER.length; i++) {
        var p = PORT_ORDER[i];
        s += '  ' + p + ' ' + hex2Byte(scopeValueByte(p, scopeHoverT));
      }
      tag(xAt(scopeHoverT), 34, s, 'rgba(246, 241, 234, .92)');
    }
    ctx.textAlign = 'left';
  }

  function drawScope() {
    var c = scopeCanvas, sc = scopeScroll, sp = scopeSpacer;
    if (curPage !== 'scope' || !c || !c.getContext || !sc) return;
    var ctx = c.getContext('2d');
    if (!ctx) return;
    /* 画布固定为可视区大小：内容多大由 spacer 决定（撑出滚动条），
       滚动偏移换算成可见时间窗口，每次只画看得见的那一片。 */
    var W = sc.clientWidth, H = sc.clientHeight;
    if (!W || !H) return;
    var dpr = window.devicePixelRatio || 1;
    var bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (c.width !== bw) c.width = bw;
    if (c.height !== bh) c.height = bh;
    c.style.width = W + 'px';
    c.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var tr = (hw && hw.trace) || [];
    /* vm 被清掉时仍按最后一条变化定右端，波形不会突然缩回去 */
    var now = Math.max(vm ? vm.vtime : 0, tr.length ? tr[tr.length - 1].t : 0);
    /* 一次都没跑过时显示引导文字；有数据后交给 canvas 自己画 */
    var emptyEl = $('scope-empty');
    if (emptyEl) emptyEl.hidden = tr.length > 0;
    /* 窗口左端：全程从 0 起；局部以当前时刻为右端回看 N ms */
    var t0 = scopeSpan === 0 ? 0 : Math.max(0, now - scopeSpan);
    if (scopeSpan !== 0 && tr.length && tr[0].t > t0) t0 = tr[0].t;
    var winDur = Math.max(1, now - t0);

    var padL = 42, padR = 10, padT = 8, padB = 15;
    var visW = Math.max(10, W - padL - padR);
    var visH = Math.max(10, H - padT - padB);

    /* 一趟扫完：start = 窗口左端的起始电平，base = 滚动值用来统计每位翻转次数。
       两者必须分开，否则波形左端会错用「最后一遍」的电平。
       扫描按整个窗口做（泳道集合不随滚动变化），画只画可见片。 */
    var start = { P0: 255, P1: 255, P2: 255, P3: 255 };
    var base = { P0: 255, P1: 255, P2: 255, P3: 255 };
    var seg = { P0: [], P1: [], P2: [], P3: [] };
    var cnt = { P0: [0, 0, 0, 0, 0, 0, 0, 0], P1: [0, 0, 0, 0, 0, 0, 0, 0],
                P2: [0, 0, 0, 0, 0, 0, 0, 0], P3: [0, 0, 0, 0, 0, 0, 0, 0] };
    for (var i = 0; i < tr.length; i++) {
      var e = tr[i];
      var pv = base[e.port];
      if (e.t < t0) { start[e.port] = e.v; base[e.port] = e.v; continue; }
      var d = pv ^ e.v;
      if (d) for (var bb = 0; bb < 8; bb++) if ((d >> bb) & 1) cnt[e.port][bb]++;
      seg[e.port].push(e);
      base[e.port] = e.v;
    }

    /* 泳道：所有变化过的位全列出来（最多 32 条），固定行高，纵向滚动查看 */
    var pool = {}, lanes = [];
    PORT_ORDER.forEach(function (p) {
      pool[p] = [];
      for (var b = 7; b >= 0; b--) if (cnt[p][b] > 0) pool[p].push(b);
    });
    var added = true;
    while (added) {
      added = false;
      for (var pi = 0; pi < PORT_ORDER.length; pi++) {
        var pp = PORT_ORDER[pi];
        if (pool[pp].length) {
          lanes.push({ port: pp, bit: pool[pp].shift() });
          added = true;
        }
      }
    }
    lanes.sort(function (a, b) {
      return a.port === b.port ? a.bit - b.bit : (a.port < b.port ? -1 : 1);
    });

    var laneH = 26;
    /* 内容尺寸：适应模式无横向滚动；放大后内容宽 = 窗口 × 每毫秒像素 */
    var contentW = scopeZoom > 0 ? Math.max(W, Math.round(padL + winDur * scopeZoom + padR)) : W;
    var contentH = Math.max(H, padT + lanes.length * laneH + padB + 2);
    if (sp && sp.style) {
      /* 运行中内容变宽时，若本来就在最右端就自动跟随，不用手动拖 */
      var atRight = sc.scrollLeft + sc.clientWidth >= (sp.offsetWidth || contentW) - 2;
      sp.style.width = contentW + 'px';
      sp.style.height = contentH + 'px';
      if (atRight && contentW > W) sc.scrollLeft = contentW - W;
    }
    var scrollX = sc.scrollLeft || 0, scrollY = sc.scrollTop || 0;
    /* canvas 是绝对定位、不参与内容布局：每次绘制把它挪回当前可视位置 */
    c.style.left = scrollX + 'px';
    c.style.top = scrollY + 'px';
    var plotScale = scopeZoom > 0 ? scopeZoom : visW / winDur;
    var t0v = t0 + scrollX / plotScale;      /* 可见窗口左端的时间 */
    var durV = visW / plotScale;             /* 可见窗口的时长 */
    /* 泳道 0 在画布上的 y：内容没超高时垂直居中（观感同旧版），超高后随滚动上移 */
    var top0 = contentH <= H
      ? padT + Math.max(0, (visH - lanes.length * laneH) / 2)
      : padT - scrollY;

    ctx.strokeStyle = 'rgba(255,255,255,.055)';
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var gx = Math.round(padL + visW * g / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + visH); ctx.stroke();
    }

    if (!lanes.length) {
      ctx.fillStyle = 'rgba(246,241,234,.3)';
      ctx.font = '11px "Microsoft YaHei", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(now < 20 ? '点「运行」，这里会画出引脚电平的变化' : '这个时间窗口里没有任何引脚变化',
        padL + visW / 2, padT + visH / 2);
      ctx.textAlign = 'left';
      scopeView = { t0: t0v, dur: durV, padL: padL, plotW: visW, now: now,
                    lanes: [], start: start, seg: seg };
      updateScopeInfo(now, tr.length, 0);
      return;
    }

    var sx = plotScale;
    ctx.font = '9.5px "Cascadia Mono", Consolas, monospace';

    for (var li = 0; li < lanes.length; li++) {
      var top = top0 + li * laneH;
      if (top + laneH < padT || top > H - padB) continue;   /* 可见区外的泳道跳过 */
      var ln = lanes[li];
      var hiY = Math.round(top + laneH * 0.3) + 0.5;
      var loY = Math.round(top + laneH * 0.74) + 0.5;
      ctx.fillStyle = 'rgba(246,241,234,.44)';
      ctx.fillText(ln.port + '.' + ln.bit, 2, top + laneH / 2 + 3.5);

      var v = (start[ln.port] >> ln.bit) & 1;
      var arr = seg[ln.port];
      var lastX = -1;
      ctx.beginPath();
      ctx.moveTo(padL, v ? hiY : loY);
      for (var k = 0; k < arr.length; k++) {
        var ev = arr[k];
        var nv = (ev.v >> ln.bit) & 1;
        if (nv === v) continue;
        var x = padL + (ev.t - t0v) * sx;
        if (x > padL + visW) break;
        if (x < padL) { v = nv; continue; }
        /* 一个像素内塞了几十次翻转时合并成这一列的最终电平 */
        if (lastX >= 0 && x - lastX < 0.75) { v = nv; continue; }
        ctx.lineTo(x, v ? hiY : loY);
        ctx.lineTo(x, nv ? hiY : loY);
        v = nv;
        lastX = x;
      }
      ctx.lineTo(padL + visW, v ? hiY : loY);
      ctx.strokeStyle = 'rgba(246,241,234,.82)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(246,241,234,.26)';
    ctx.font = '9px "Cascadia Mono", Consolas, monospace';
    ctx.fillText(scopeSpan === 0 && scrollX <= 0 ? '0' : fmtMs(t0v), padL, H - 4);
    var rightT = t0 + Math.min(winDur, (scrollX + visW) / plotScale);
    if (contentW <= W && scopeSpan === 0 && durV > 2) {
      ctx.textAlign = 'center';
      ctx.fillText(fmtMs(t0v + durV / 2), padL + visW / 2, H - 4);
    }
    ctx.textAlign = 'right';
    ctx.fillText(contentW <= W && scopeSpan !== 0 ? '现在' : fmtMs(rightT), W - padR, H - 4);
    ctx.textAlign = 'left';
    scopeView = { t0: t0v, dur: durV, padL: padL, plotW: visW, now: now,
                  lanes: lanes, start: start, seg: seg, rowH: laneH, top0: top0 };
    drawScopeOverlay(ctx, W, H);
    updateScopeInfo(now, tr.length, lanes.length);
  }


  (function () {
    var segEl = $('scope-span');
    if (!segEl || !segEl.addEventListener) return;
    segEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.dataset || t.dataset.ms == null) return;
      var v = parseInt(t.dataset.ms, 10);
      scopeSpan = isNaN(v) ? 0 : v;        /* 0 是「全程」，不能用 || 兜底 */
      autoSpan();
      if (scopeScroll && scopeZoom === 0) scopeScroll.scrollLeft = 0;
      drawScope();
    });
  })();

  /* 横向缩放：适应=整窗压进面板（无横向滚动条）；>0 时内容变宽，拖滚动条左右看细节 */
  (function () {
    var segEl = $('scope-zoom');
    if (!segEl || !segEl.addEventListener) return;
    segEl.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.dataset || t.dataset.zoom == null) return;
      var v = parseFloat(t.dataset.zoom);
      scopeZoom = isNaN(v) || v < 0 ? 0 : v;
      var btns = segEl.children || [];
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList && btns[i].dataset && btns[i].dataset.zoom != null) {
          btns[i].classList.toggle('on', parseFloat(btns[i].dataset.zoom) === scopeZoom);
        }
      }
      if (scopeScroll && scopeZoom === 0) scopeScroll.scrollLeft = 0;
      drawScope();
    });
  })();

  /* 滚动条拖动：只重画可见窗口 */
  (function () {
    if (!scopeScroll || !scopeScroll.addEventListener) return;
    scopeScroll.addEventListener('scroll', function () {
      if (curPage === 'scope') drawScope();
    });
  })();

  (function () {
    if (!window.addEventListener) return;
    window.addEventListener('resize', function () {
      if (curPage === 'scope') drawScope();
    });
  })();

  /* 鼠标：悬停读端口值、单击放 A 光标、再点放 B 光标、双击清除 */
  (function () {
    var c = scopeCanvas;
    if (!c || !c.addEventListener) return;
    /* 吸附到最近的跳变沿：量两次翻转间隔多少 ms 时不用手抖对准 */
    function snapToEdge(t, tolPx) {
      var v = scopeView;
      if (!v || !v.seg) return t;
      var tol = (v.dur / Math.max(1, v.plotW)) * (tolPx || 6);
      var best = null, bd = tol;
      for (var i = 0; i < PORT_ORDER.length; i++) {
        var arr = v.seg[PORT_ORDER[i]] || [];
        var lo = 0, hi = arr.length;
        while (lo < hi) {
          var mid = (lo + hi) >> 1;
          if (arr[mid].t < t) lo = mid + 1; else hi = mid;
        }
        for (var k = lo - 1; k <= lo; k++) {
          if (k < 0 || k >= arr.length) continue;
          var d = Math.abs(arr[k].t - t);
          if (d < bd) { bd = d; best = arr[k].t; }
        }
      }
      return best == null ? t : best;
    }
    function tAt(e) {
      if (!scopeView) return null;
      var r = c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0 };
      var x = (e.clientX || 0) - (r.left || 0);
      var v = scopeView;
      if (x < v.padL || x > v.padL + v.plotW) return null;
      var t = Math.max(v.t0, Math.min(v.now, v.t0 + (x - v.padL) / v.plotW * v.dur));
      return snapToEdge(t, 6);
    }
    c.addEventListener('mousemove', function (e) {
      var t = tAt(e);
      if (t === scopeHoverT) return;
      scopeHoverT = t;
      if (curPage === 'scope') drawScope();
    });
    c.addEventListener('mouseleave', function () {
      scopeHoverT = null;
      if (curPage === 'scope') drawScope();
    });
    c.addEventListener('click', function (e) {
      var t = tAt(e);
      if (t == null) return;
      /* 第一下放 A，第二下放 B，第三下重新从 A 开始；双击统一清空 */
      if (scopeCursorA == null || scopeCursorB != null) {
        scopeCursorA = t; scopeCursorB = null;
      } else {
        scopeCursorB = t;
      }
      if (scopeCursorA != null && scopeCursorB != null && scopeCursorA > scopeCursorB) {
        var tmp = scopeCursorA; scopeCursorA = scopeCursorB; scopeCursorB = tmp;
      }
      if (curPage === 'scope') drawScope();
    });
    c.addEventListener('dblclick', function () {
      scopeCursorA = scopeCursorB = null;
      if (curPage === 'scope') drawScope();
    });
  })();

  /* 导出：PNG 存当前画面；CSV 存本次运行的全部电平变化，可直接用 Excel 打开 */
  function saveBlob(name, blob) {
    try {
      var a = document.createElement('a');
      if (!a || typeof URL === 'undefined' || !URL.createObjectURL) return;
      a.download = name;
      a.href = URL.createObjectURL(blob);
      if (a.click) a.click();
      setTimeout(function () {
        if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(a.href);
      }, 2000);
    } catch (e) { log('导出失败：' + (e && e.message ? e.message : e), 'err'); }
  }
  (function () {
    var b = $('btn-scope-png');
    if (b && b.addEventListener) b.addEventListener('click', function () {
      if (!scopeCanvas || !scopeCanvas.toDataURL) return;
      if (curPage === 'scope') drawScope();
      try {
        var a = document.createElement('a');
        a.download = '51时序图.png';
        a.href = scopeCanvas.toDataURL('image/png');
        if (a.click) a.click();
      } catch (e) { log('导出 PNG 失败：' + (e && e.message ? e.message : e), 'err'); }
    });
    var c = $('btn-scope-csv');
    if (c && c.addEventListener) c.addEventListener('click', function () {
      var tr = (hw && hw.trace) || [];
      var lines = ['时间(ms),端口,十六进制,二进制'];
      for (var i = 0; i < tr.length; i++) {
        var e = tr[i];
        lines.push(e.t.toFixed(3) + ',' + e.port + ',' + hex2Byte(e.v) + ','
          + ('00000000' + e.v.toString(2)).slice(-8));
      }
      if (typeof Blob === 'undefined') { log('当前浏览器不支持导出 CSV。', 'err'); return; }
      saveBlob('51波形数据.csv', new Blob(['\ufeff' + lines.join('\r\n')],
        { type: 'text/csv;charset=utf-8' }));
      log('已导出 ' + tr.length + ' 条电平变化（CSV）。', 'dim');
    });
  })();

  /* ---------------- 分享链接：把当前代码压进 hash ---------------- */
  function b64enc(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64dec(str) {
    var t = str.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        res();
      } catch (e) { rej(e); }
    });
  }
  $('btn-share').onclick = function () {
    var base = String(location.href).split('#')[0];
    var id = curExample ? curExample.id : 'led-on';
    var cur = fileOf(project.active);
    if (cur) cur.content = codeEl.value;
    var single = project.files.length === 1 && project.files[0].path === 'main.c'
      && curExample && project.files[0].content === curExample.code;
    var url;
    if (single) {
      url = base + '#ex=' + id + '&ro=1';
    } else {
      url = base + '#ex=' + id + '&p=' + b64enc(JSON.stringify({
        name: project.name, files: project.files,
        folders: project.folders, folderGroup: project.folderGroup,
    groups: project.groups, open: project.open, active: project.active
      })) + '&ro=1';
    }
    copyText(url).then(function () {
      log(single
        ? '分享链接已复制（当前就是讲义原版例程）。'
        : '分享链接已复制，里面带着整个工程的 ' + project.files.length + ' 个文件（' + url.length + ' 个字符）。', 'ok');
    }, function () {
      log('浏览器不允许自动复制，请手动复制地址栏链接。', 'err');
    });
  };

  /* ---------------- 编辑器：语法高亮 / 行号 / 行标记 / 编译输出 ----------------
     高亮做法：把着色后的 HTML 放进 textarea 底下那层 <pre>，
     textarea 文字透明、只留光标，两层字体与行高完全一致，滚动同步。
  ------------------------------------------------------------------ */
  var hlEl = $('hl'), marksEl = $('marks');
  var errLine = 0;
  var LINE_H = 23;

  var HL_KW = {}, HL_TY = {}, HL_REG = {};
  ('if else while for do switch case default break continue return sizeof typedef struct union enum '
    + 'static const extern volatile sbit sfr sfr16 bit data idata pdata xdata code reentrant '
    + 'interrupt using goto').split(' ').forEach(function (k) { HL_KW[k] = 1; });
  ('void char int short long float double unsigned signed').split(' ').forEach(function (k) { HL_TY[k] = 1; });
  ('TMOD TCON TH0 TH1 TL0 TL1 SCON SBUF IE IP PCON EA ET0 ET1 TR0 TR1 EX0 IT0 PSW ACC B DPTR').split(' ')
    .forEach(function (k) { HL_REG[k] = 1; });

  var HL_RE = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:\\[\s\S]|[^"\\])*")|('(?:\\[\s\S]|[^'\\])*')|(^[ \t]*#[^\n]*)|(0[xX][0-9a-fA-F]+|\d+)|([A-Za-z_]\w*)/gm;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function highlightC51(src) {
    var out = '', last = 0, m;
    HL_RE.lastIndex = 0;
    while ((m = HL_RE.exec(src)) !== null) {
      if (m.index > last) out += esc(src.slice(last, m.index));
      last = HL_RE.lastIndex;
      var cls = '';
      if (m[1] || m[2]) cls = 'hl-c';
      else if (m[3] || m[4]) cls = 'hl-s';
      else if (m[5]) cls = 'hl-p';
      else if (m[6]) cls = 'hl-n';
      else if (m[7]) {
        var w = m[7];
        if (HL_KW[w]) cls = 'hl-k';
        else if (HL_TY[w]) cls = 'hl-t';
        else if (HL_REG[w] || /^P[0-3](_[0-7])?$/.test(w)) cls = 'hl-r';
        else if (/^[ \t]*\(/.test(src.slice(HL_RE.lastIndex, HL_RE.lastIndex + 6))) cls = 'hl-f';
      }
      out += cls ? '<span class="' + cls + '">' + esc(m[0]) + '</span>' : esc(m[0]);
      if (m[0].length === 0) HL_RE.lastIndex++;
    }
    if (last < src.length) out += esc(src.slice(last));
    return out;
  }
  function paintCode() {
    if (!hlEl) return;
    /* 末尾补一个换行，保证最后一行有高度，和 textarea 对齐 */
    hlEl.innerHTML = highlightC51(codeEl.value) + '\n';
    syncCodeScroll();
  }
  function syncCodeScroll() {
    if (hlEl) { hlEl.scrollTop = codeEl.scrollTop; hlEl.scrollLeft = codeEl.scrollLeft; }
    if (marksEl) marksEl.style.transform = 'translateY(' + (-codeEl.scrollTop) + 'px)';
  }
  function paintMarks() {
    if (!marksEl) return;
    var html = '';
    var pad = 12;
    /* 光标所在行：和错误行、执行行一样画在 marks 层，不用改高亮 HTML */
    var curLn = codeEl.value.slice(0, codeEl.selectionStart).split('\n').length;
    html += '<i class="focus" style="top:' + (pad + (curLn - 1) * LINE_H) + 'px"></i>';
    var showErr = errLine && (!errFile || errFile === project.active);
    if (showErr) html += '<i class="err" style="top:' + (pad + (errLine - 1) * LINE_H) + 'px"></i>';
    var loc = (vm && (state === 'running' || state === 'paused')) ? mapUnitLine(vm.line) : null;
    if (loc && loc.line && loc.file === project.active && loc.line !== errLine) {
      html += '<i class="cur" style="top:' + (pad + (loc.line - 1) * LINE_H) + 'px"></i>';
    }
    if (marksEl.innerHTML !== html) marksEl.innerHTML = html;
  }
  function updateCursor() {
    var cf = $('cur-file');
    if (cf) cf.textContent = project.active || '（没有打开的文件）';
    var el = $('cur-line');
    if (!el) return;
    var upto = codeEl.value.slice(0, codeEl.selectionStart);
    var line = upto.split('\n').length;
    var col = upto.length - upto.lastIndexOf('\n');
    el.textContent = '行 ' + line + '，列 ' + col;
    paintMarks();
  }
  function gotoFileLine(file, n) {
    if (file && file !== project.active) openFile(file);
    gotoLine(n);
  }
  function gotoLine(n) {
    var lines = codeEl.value.split('\n');
    var pos = 0;
    for (var i = 0; i < n - 1 && i < lines.length; i++) pos += lines[i].length + 1;
    codeEl.focus();
    codeEl.selectionStart = codeEl.selectionEnd = Math.min(pos, codeEl.value.length);
    codeEl.scrollTop = Math.max(0, (n - 1) * LINE_H - codeEl.clientHeight / 2);
    syncCodeScroll();
    updateCursor();
  }

  /* 编译输出：仿 Keil 的 Build Output，错误行可点 */
  var problems = [];
  var probFilter = 'all';

  function clearBuild() {
    var h = $('build-log');
    if (h) h.innerHTML = '';
    problems = [];
    probFilter = 'all';
    renderProblems();
  }
  function addProblem(level, file, line, msg) {
    var m = String(msg == null ? '' : msg);
    var hint = '';
    try { hint = typeof diagnose === 'function' ? diagnose(m) : ''; } catch (e) { hint = ''; }
    problems.push({ level: level, file: file || '', line: line || 0, msg: m, hint: hint });
  }
  /* 运行期错误：同样进问题列表，并附一句修改建议 */
  function addRunProblem(msg, file, line) {
    var hint = '';
    try { hint = typeof diagnose === 'function' ? diagnose(msg) : ''; } catch (e) { hint = ''; }
    if (hint) buildLine('建议：' + hint, 'warn');
    addProblem('error', file || '', line || 0, msg);
    renderProblems();
  }
  /* 结构化问题列表：级别 / 文件 / 行 / 说明；点一行跳到源码对应位置 */
  function renderProblems() {
    var host = $('build-problems');
    if (!host) return;
    if (!problems.length) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    host.innerHTML = '';
    var nErr = problems.filter(function (p) { return p.level === 'error'; }).length;
    var nWarn = problems.length - nErr;

    var bar = document.createElement('div');
    bar.className = 'prob-filter';
    [['all', '全部 ' + problems.length], ['error', '错误 ' + nErr], ['warn', '警告 ' + nWarn]]
      .forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = it[1];
        if (probFilter === it[0]) b.className = 'on';
        b.addEventListener('click', function () { probFilter = it[0]; renderProblems(); });
        bar.appendChild(b);
      });
    host.appendChild(bar);

    var head = document.createElement('div');
    head.className = 'prob-row prob-head';
    ['级别', '文件', '行', '说明'].forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      head.appendChild(s);
    });
    host.appendChild(head);

    problems.filter(function (p) {
      return probFilter === 'all' || p.level === probFilter;
    }).forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'prob-row ' + (p.level === 'error' ? 'err' : 'warn');
      var a = document.createElement('span');
      a.className = 'lvl';
      a.textContent = p.level === 'error' ? '错误' : '警告';
      var b = document.createElement('span');
      b.textContent = p.file || '-';
      var c = document.createElement('span');
      c.textContent = p.line ? String(p.line) : '-';
      var d = document.createElement('span');
      d.className = 'msg';
      d.textContent = p.msg;
      row.appendChild(a);
      row.appendChild(b);
      row.appendChild(c);
      row.appendChild(d);
      if (p.hint) {
        var hintEl = document.createElement('span');
        hintEl.className = 'prob-hint';
        hintEl.textContent = '建议：' + p.hint;
        row.appendChild(hintEl);
      }
      if (p.line) {
        row.addEventListener('click', function () { gotoFileLine(p.file || project.active, p.line); });
      }
      host.appendChild(row);
    });
  }
  function buildLine(text, cls, line, file) {
    var host = $('build-log');
    if (!host) return;
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = text;
    if (line) {
      d.dataset.line = line;
      d.addEventListener('click', function () { gotoFileLine(file || project.active, line); });
    }
    host.appendChild(d);
    host.scrollTop = host.scrollHeight;
  }
  function setBuildSum(text, cls) {
    var el = $('build-sum');
    if (!el) return;
    el.textContent = text;
    el.style.color = cls === 'err' ? '#ff8f7e' : (cls === 'ok' ? '#4ad79c' : '');
    /* 编译报错时自动展开输出区，错误不能被折叠藏起来 */
    if (cls === 'err') setBuildCollapsed(false);
  }

  /* ---------- SFR 寄存器面板：十六进制值 + 位域，参考 EdSim51 的位域视图 ---------- */
  var SFR_VIEW = ['TMOD', 'TCON', 'IE', 'SCON', 'PSW', 'ACC'];
  var SFR_BIT_NAMES = {
    TCON: ['IT0', 'IE0', 'IT1', 'IE1', 'TR0', 'TF0', 'TR1', 'TF1'],
    IE: ['EX0', 'ET0', 'EX1', 'ET1', 'ES', '', '', 'EA'],
    SCON: ['RI', 'TI', 'RB8', 'TB8', 'REN', 'SM2', 'SM1', 'SM0'],
    PSW: ['P', '', 'OV', 'RS0', 'RS1', 'F0', 'AC', 'CY'],
    TMOD: ['M0', 'M1', 'C/T', 'GATE', 'M0', 'M1', 'C/T', 'GATE']
  };
  var sfrSig = '';
  function renderSfr() {
    var host = $('sfr');
    if (!host) return;
    if (!vm) {
      if (sfrSig !== 'none') {
        host.innerHTML = '<div class="sfr-empty">运行后显示 TMOD / TCON / IE 等寄存器的值和每一位</div>';
        sfrSig = 'none';
      }
      return;
    }
    var vals = [], i;
    for (i = 0; i < SFR_VIEW.length; i++) vals.push((vm.sfr[SFR_VIEW[i]] || 0) & 0xff);
    var t0 = ((vm.sfr.TH0 || 0) << 8) | (vm.sfr.TL0 || 0);
    var t1 = ((vm.sfr.TH1 || 0) << 8) | (vm.sfr.TL1 || 0);
    var sig = vals.join(',') + '|' + t0 + '|' + t1;
    if (sig === sfrSig) return;
    sfrSig = sig;
    var html = '';
    for (i = 0; i < SFR_VIEW.length; i++) {
      var name = SFR_VIEW[i], val = vals[i];
      html += '<div class="sfr-row"><span class="sfr-name">' + name + '</span>'
        + '<span class="sfr-hex">' + ('0' + val.toString(16).toUpperCase()).slice(-2) + 'h</span><span class="sfr-bits">';
      for (var b = 7; b >= 0; b--) {
        var bitName = (SFR_BIT_NAMES[name] && SFR_BIT_NAMES[name][b]) || ('bit' + b);
        var one = (val >> b) & 1;
        html += '<i class="sfr-bit' + (one ? ' one' : '') + '" title="' + name + '.' + b + ' = ' + bitName + '">' + one + '</i>';
      }
      html += '</span></div>';
    }
    var tmod = vm.sfr.TMOD || 0;
    html += '<div class="sfr-timer">T0 = 0x' + t0.toString(16).toUpperCase() + '（' + t0 + '）· 方式 ' + (tmod & 3) + ' · '
      + ((vm.sfr.TCON & 0x10) ? '运行中' : '停止')
      + '<br>T1 = 0x' + t1.toString(16).toUpperCase() + '（' + t1 + '）· 方式 ' + ((tmod >> 4) & 3) + ' · '
      + ((vm.sfr.TCON & 0x40) ? '运行中' : '停止') + '</div>';
    host.innerHTML = html;
  }

  /* 手动 Watch：用户自己加的变量名，存在本地，下次打开还在 */
  var watchExprs = [];
  try { watchExprs = JSON.parse(localStorage.getItem('c51.watch') || '[]') || []; } catch (e) { watchExprs = []; }
  function saveWatchExprs() {
    try { localStorage.setItem('c51.watch', JSON.stringify(watchExprs)); } catch (e) { /* 忽略 */ }
  }
  function addWatchExpr(name) {
    name = String(name || '').trim();
    if (!name) return;
    if (watchExprs.indexOf(name) < 0) { watchExprs.push(name); saveWatchExprs(); }
    watchSig = '';
    renderWatch();
  }
  function removeWatchExpr(name) {
    watchExprs = watchExprs.filter(function (n) { return n !== name; });
    saveWatchExprs();
    watchSig = '';
    renderWatch();
  }
  function watchValueOf(name) {
    if (!vm) return '—';
    try { return fmtVal(vm.getVar(name)); } catch (e) { return '未定义'; }
  }

  /* 变量监视：当前帧局部变量 + 全局变量 + 手动加入的 Watch */
  var watchSig = '';
  function fmtVal(v) {
    if (Array.isArray(v)) {
      var n = Math.min(v.length, 8), arr = [];
      for (var i = 0; i < n; i++) arr.push(v[i]);
      return '[' + arr.join(', ') + (v.length > n ? ', …' : '') + ']';
    }
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
    return String(v);
  }
  function renderWatch() {
    var host = $('watch');
    if (!host) return;
    renderSfr();
    var rows = [];
    if (vm) {
      var f = vm.frames && vm.frames.length ? vm.frames[vm.frames.length - 1] : null;
      if (f && f.vars) for (var k in f.vars) { if (k) rows.push([k, f.vars[k]]); }
      for (var g in vm.globals) { if (g) rows.push([g, vm.globals[g]]); }
    }
    var sig = (vm ? 'run' : 'none') + '#' + watchExprs.join(',') + '#'
      + rows.map(function (r) { return r[0] + '=' + fmtVal(r[1]); }).join('|');
    if (sig === watchSig) return;
    watchSig = sig;
    var html = '', i;
    for (i = 0; i < watchExprs.length; i++) {
      var nm = watchExprs[i];
      html += '<div class="w-row w-custom"><span class="w-name">' + esc(nm) + '</span>'
        + '<span class="w-val">' + esc(watchValueOf(nm))
        + '<button class="w-del" data-watch-del="' + encodeURIComponent(nm) + '" title="移除这个监视">×</button></span></div>';
    }
    if (!vm) {
      html += '<div class="w-empty">点「运行」后显示局部变量和全局变量；也可以在下面输入变量名加入监视</div>';
      host.innerHTML = html;
      return;
    }
    if (!rows.length && !watchExprs.length) { host.innerHTML = '<div class="w-empty">这个例程没有变量</div>'; return; }
    for (i = 0; i < rows.length && i < 40; i++) {
      html += '<div class="w-row"><span class="w-name">' + esc(rows[i][0]) + '</span>'
        + '<span class="w-val">' + esc(fmtVal(rows[i][1])) + '</span></div>';
    }
    host.innerHTML = html;
  }

  /* ==================== 撤销 / 重做（按文件记，切文件也不丢） ====================
     做法：每次输入只记「这一串连续输入开始前的样子」，空闲 0.5 秒算一段。
     程序改动（整理、替换全部、还原）之前强制记一笔。
  ======================================================================== */
  var histMap = {};
  function histReset(path, value) {
    if (!path) return;
    histMap[path] = { undo: [], redo: [], prev: String(value == null ? '' : value), t: 0 };
  }
  function histSt() {
    var path = project.active;
    if (!path) return null;
    if (!histMap[path]) histReset(path, codeEl.value);
    return histMap[path];
  }
  function histRecord() {
    var st = histSt();
    if (!st) return;
    var now = Date.now(), val = codeEl.value;
    if (now - st.t > 500) {
      st.undo.push({ v: st.prev });
      if (st.undo.length > 200) st.undo.shift();
      st.redo.length = 0;
    }
    st.prev = val;
    st.t = now;
  }
  function applyHist(v) {
    codeEl.value = v;
    var f = fileOf(project.active);
    if (f) f.content = v;
    refreshGutter();
    paintCode();
    updateCursor();
    saveCode();
  }
  function histUndo() {
    var st = histSt();
    if (!st || !st.undo.length) return;
    var e = st.undo.pop();
    st.redo.push({ v: codeEl.value });
    applyHist(e.v);
    st.prev = e.v;
    st.t = 0;
    log('撤销', 'dim');
  }
  function histRedo() {
    var st = histSt();
    if (!st || !st.redo.length) return;
    var e = st.redo.pop();
    st.undo.push({ v: codeEl.value });
    applyHist(e.v);
    st.prev = e.v;
    st.t = 0;
    log('重做', 'dim');
  }

  /* ==================== 查找 / 替换 ==================== */
  var findBar = $('findbar'), findInput = $('find-input'), findCount = $('find-count');
  var replaceInput = $('replace-input');
  var findState = { q: '', matches: [], at: -1 };

  function escRe(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function collectMatches() {
    findState.q = findInput ? findInput.value : '';
    findState.matches = [];
    findState.at = -1;
    if (!findState.q) { paintCount(); return; }
    var re = new RegExp(escRe(findState.q), 'g');
    var text = codeEl.value, m, guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 20000) {
      findState.matches.push(m.index);
      if (!m[0].length) re.lastIndex++;
    }
    paintCount();
  }
  function paintCount() {
    if (!findCount) return;
    var n = findState.matches.length;
    findCount.textContent = (findState.at >= 0 ? (findState.at + 1) : 0) + '/' + n;
    findCount.style.color = n ? '' : '#ff8f7e';
  }
  function openFind() {
    if (!findBar) return;
    findBar.hidden = false;
    var sel = '';
    try { sel = codeEl.value.slice(codeEl.selectionStart, codeEl.selectionEnd); } catch (e) {}
    if (sel && sel.indexOf('\n') < 0) findInput.value = sel;
    findInput.focus();
    findInput.select();
    collectMatches();
  }
  function closeFind() {
    if (findBar) findBar.hidden = true;
    codeEl.focus();
  }
  function selectAt(i) {
    var m = findState.matches[i];
    if (m == null) return;
    findState.at = i;
    try { codeEl.selectionStart = m; codeEl.selectionEnd = m + findState.q.length; } catch (e) {}
    var line = codeEl.value.slice(0, m).split('\n').length;
    codeEl.scrollTop = Math.max(0, (line - 1) * LINE_H - codeEl.clientHeight / 2);
    syncCodeScroll();
    paintCount();
  }
  function findGo(dir) {
    if (!findBar || findBar.hidden) { openFind(); return; }
    if (!findState.q || findState.q !== (findInput ? findInput.value : '')) collectMatches();
    if (!findState.matches.length) return;
    var i;
    if (dir < 0) {
      i = -1;
      for (var k = findState.matches.length - 1; k >= 0; k--) {
        if (findState.matches[k] < codeEl.selectionStart) { i = k; break; }
      }
      if (i < 0) i = findState.matches.length - 1;
    } else {
      i = -1;
      for (var j = 0; j < findState.matches.length; j++) {
        if (findState.matches[j] > Math.max(codeEl.selectionStart, codeEl.selectionEnd - 1)) { i = j; break; }
      }
      if (i < 0) i = 0;
    }
    selectAt(i);
  }
  function replaceOne() {
    if (!findState.matches.length) collectMatches();
    if (!findState.matches.length) return;
    var m = findState.matches[findState.at >= 0 ? findState.at : 0];
    var val = codeEl.value;
    if (val.substr(m, findState.q.length) !== findState.q) { collectMatches(); return; }
    histRecord();
    codeEl.value = val.slice(0, m) + (replaceInput ? replaceInput.value : '') + val.slice(m + findState.q.length);
    applyHist(codeEl.value);
    collectMatches();
    findGo(1);
  }
  function replaceAll() {
    if (!findState.matches.length) collectMatches();
    if (!findState.matches.length) { log('没有可替换的内容。', 'dim'); return; }
    histRecord();
    var n = findState.matches.length;
    codeEl.value = codeEl.value.split(findState.q).join(replaceInput ? replaceInput.value : '');
    applyHist(codeEl.value);
    collectMatches();
    log('已替换 ' + n + ' 处。', 'ok');
  }
  if (findInput) findInput.addEventListener('input', function () { collectMatches(); findGo(1); });
  if (findInput) findInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  if (replaceInput) replaceInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  if ($('find-next')) $('find-next').onclick = function () { findGo(1); };
  if ($('find-prev')) $('find-prev').onclick = function () { findGo(-1); };
  if ($('find-replace')) $('find-replace').onclick = function () { replaceOne(); };
  if ($('find-all')) $('find-all').onclick = function () { replaceAll(); };
  if ($('find-close')) $('find-close').onclick = function () { closeFind(); };

  /* ==================== 符号表：大纲 + 跳转到定义 ==================== */
  var NOT_FN = { if: 1, while: 1, for: 1, switch: 1, return: 1, do: 1, else: 1, sizeof: 1 };
  function collectSymbols(text) {
    var out = [];
    var rows = String(text).replace(/\r\n?/g, '\n').split('\n');
    var reFn = /^\s*(?:unsigned\s+|signed\s+)?[A-Za-z_]\w*[\s\*]+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*([;{]?)\s*$/;
    var reVar = /^\s*(?:unsigned\s+|signed\s+|const\s+|static\s+|volatile\s+)*(?:char|int|short|long|float|double|bit|sfr|sbit)\b[^;(){}]*?\b([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:=[^;]*)?;/;
    for (var i = 0; i < rows.length; i++) {
      var raw = rows[i], m;
      if (/^\s*\/\//.test(raw) || /^\s*\*/.test(raw)) continue;
      var line = raw.replace(/\/\/.*$/, '');   /* 去掉行尾注释再认 */
      m = /^\s*#define\s+([A-Za-z_]\w*)/.exec(line);
      if (m) { out.push({ kind: 'def', name: m[1], line: i + 1 }); continue; }
      m = reFn.exec(line);
      if (m && !NOT_FN[m[1]]) {
        out.push({ kind: m[3] === ';' ? 'proto' : 'fn', name: m[1], line: i + 1 });
        continue;
      }
      m = reVar.exec(line);
      if (m) out.push({ kind: 'var', name: m[1], line: i + 1 });
    }
    return out;
  }
  function symbolIndex() {
    var idx = {};
    project.files.forEach(function (f) {
      if (!/\.(c|h|inc)$/i.test(f.path)) return;
      var text = f.path === project.active ? codeEl.value : f.content;
      collectSymbols(text).forEach(function (s) {
        (idx[s.name] || (idx[s.name] = [])).push({ file: f.path, line: s.line });
      });
    });
    return idx;
  }
  function wordAt(text, pos) {
    var re = /[A-Za-z_]\w*/g, m;
    while ((m = re.exec(text)) !== null) {
      if (pos >= m.index && pos <= m.index + m[0].length) return m[0];
      if (m.index > pos) break;
    }
    return '';
  }
  function currentLocalLine() {
    return codeEl.value.slice(0, codeEl.selectionStart).split('\n').length;
  }
  function gotoDefinition() {
    var w = wordAt(codeEl.value, codeEl.selectionStart);
    if (!w) { log('把光标放在函数名或变量名上再按 F12。', 'dim'); return; }
    var idx = symbolIndex(), list = idx[w];
    if (!list || !list.length) { log('没找到 “' + w + '” 的定义（可能是库函数或拼错了）。', 'dim'); return; }
    var here = currentLocalLine(), hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].file !== project.active || list[i].line !== here) { hit = list[i]; break; }
    }
    if (!hit) hit = list[0];
    gotoFileLine(hit.file, hit.line);
    log('已跳到 “' + w + '” 的定义：' + hit.file + ' 第 ' + hit.line + ' 行。', 'dim');
  }

  /* 大纲面板 */
  var projTab = 'tree';
  function setProjTab(name) {
    projTab = name;
    var tabs = $('proj-tabs');
    if (tabs && tabs.querySelectorAll) {
      var bs = tabs.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        var on = bs[i].dataset && bs[i].dataset.ptab === name;
        if (bs[i].classList) { if (on) bs[i].classList.add('on'); else bs[i].classList.remove('on'); }
      }
    }
    var tree = $('proj-tree'), out = $('outline');
    if (tree) tree.hidden = name !== 'tree';
    if (out) out.hidden = name !== 'outline';
    if (name === 'outline') renderOutline();
  }
  function renderOutline() {
    var host = $('outline');
    if (!host) return;
    host.innerHTML = '';
    if (!project.active) {
      host.innerHTML = '<div class="proj-empty">先打开一个文件。</div>';
      return;
    }
    var syms = collectSymbols(codeEl.value);
    if (!syms.length) {
      host.innerHTML = '<div class="proj-empty">这个文件里没识别到函数或全局变量。</div>';
      return;
    }
    var ICON = { fn: 'ƒ', proto: 'ƒ', var: 'v', def: '#' };
    var last = '';
    syms.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'p-row outline-row';
      if (s.kind !== last) { row.style.marginTop = last ? '6px' : '0'; }
      last = s.kind;
      var ic = document.createElement('span');
      ic.className = 'ico';
      ic.textContent = ICON[s.kind] || '·';
      var nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = s.name;
      var ln = document.createElement('span');
      ln.className = 'ln';
      ln.textContent = s.line;
      row.appendChild(ic);
      row.appendChild(nm);
      row.appendChild(ln);
      row.addEventListener('click', function () { gotoLine(s.line); });
      host.appendChild(row);
    });
  }

  /* ==================== 断点 ==================== */
  /* v1 时代会把 #include / 空行上的断点自动挪到后面，旧存档里可能留着被挪到
     第 5 行的断点。整套断点语义变了，索性换前缀，让旧存档自然失效。 */
  var BP_PREFIX = 'c51lab.bp.v2.';
  var breakpoints = {};
  var bpSnap = {};   /* 断点标记所在行 → 实际会停下的行（空行 / #include 会往后吸附） */
  var pausedAtBp = false;
  function rebuildBpKeys() {
    bpSnap = {};
    Object.keys(breakpoints).forEach(function (f) {
      (breakpoints[f] || []).forEach(function (l) {
        var t = snapBpLine(f, l);
        bpSnap[f + ':' + (t || l)] = 1;
      });
    });
  }
  var lastStopKey = '';
  function bpKey() { return BP_PREFIX + (project.fs ? 'fs:' + FS.name : (curExample ? curExample.id : 'free')); }
  function loadBp() {
    breakpoints = {};
    try {
      var raw = window.localStorage.getItem(bpKey());
      if (raw) breakpoints = JSON.parse(raw) || {};
    } catch (e) { breakpoints = {}; }
    rebuildBpKeys();
    lastGutterLine = -1;
    renderDebug();
  }
  function saveBp() {
    try { window.localStorage.setItem(bpKey(), JSON.stringify(breakpoints)); } catch (e) {}
  }
  function bpOf(file) { return (file && breakpoints[file]) || []; }
  function isBp(file, line) { return bpOf(file).indexOf(line) >= 0; }
  var STMT_T = { expr: 1, decl: 1, if: 1, while: 1, for: 1, do: 1, switch: 1, return: 1, break: 1, continue: 1, empty: 1 };
  function collectStmtLines(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) collectStmtLines(node[i], out);
      return;
    }
    if (node.t && STMT_T[node.t] && typeof node.line === 'number') out[node.line] = 1;
    for (var k in node) {
      if (k === 'line' || k === 't') continue;
      var v = node[k];
      if (v && typeof v === 'object') collectStmtLines(v, out);
    }
  }
  /* 断点标记留在用户点的行上（空行、#include 也能点）；
     运行时往后找第一条能执行的语句，函数声明行本身也算一个可停的位置。 */
  function snapBpLine(file, line) {
    if (!vm || !lastUnit || !vm.ast) return line;
    var set = {};
    collectStmtLines(vm.ast, set);
    var funcLines = {};
    (vm.ast.body || []).forEach(function (d) {
      if (d && d.t === 'func' && typeof d.line === 'number') funcLines[d.line] = 1;
    });
    var best = 0;
    for (var i = 0; i < lastUnit.map.length; i++) {
      var m = lastUnit.map[i];
      if (m.file !== file || !m.line) continue;
      if (!set[i + 1] && !funcLines[i + 1]) continue;
      if (m.line >= line && (!best || m.line < best)) best = m.line;
    }
    return best || line;
  }
  function toggleBp(file, rawLine) {
    if (!file || !rawLine) { log('先打开一个文件，再点行号设断点。', 'dim'); return; }
    var a = breakpoints[file] || (breakpoints[file] = []);
    var i = a.indexOf(rawLine);
    if (i >= 0) a.splice(i, 1); else a.push(rawLine);
    a.sort(function (x, y) { return x - y; });
    if (!a.length) delete breakpoints[file];
    rebuildBpKeys();
    saveBp();
    lastGutterLine = -1;
    refreshGutter();
    markLine(state === 'running' || state === 'paused' ? vmLocalLine() : 0);
    renderDebug();
    log((i >= 0 ? '已取消断点 ' : '已加断点 ') + file + ':' + rawLine, 'dim');
    if (i < 0) {
      var target = snapBpLine(file, rawLine);
      if (target !== rawLine) log('第 ' + rawLine + ' 行没有可执行的语句，运行时会停在第 ' + target + ' 行。', 'dim');
    }
  }
  function vmLocalLine() {
    var loc = vm ? mapUnitLine(vm.line) : null;
    return loc && loc.file === project.active ? loc.line : 0;
  }
  /* ---------------- 条件断点 / 日志断点：Shift + 点行号设置 ---------------- */
  var bpConds = {};
  try { bpConds = JSON.parse(localStorage.getItem('c51.bpconds') || '{}') || {}; } catch (e) { bpConds = {}; }
  function saveBpConds() {
    try { localStorage.setItem('c51.bpconds', JSON.stringify(bpConds)); } catch (e) { /* 忽略 */ }
  }
  function bpCondOf(key) { return bpConds[key] || ''; }
  function evalBpValue(name) {
    if (!vm) return undefined;
    try { return vm.getVar(name); } catch (e) { return undefined; }
  }
  /* 只支持教学够用的形式：i == 10、count >= 3、P2 != 0xFF，或单变量 i（非零即真） */
  function evalBpCond(expr) {
    var m = /^\s*([A-Za-z_]\w*)\s*(==|!=|>=|<=|>|<)\s*(-?\d+(?:\.\d+)?|0x[0-9a-fA-F]+)\s*$/.exec(expr);
    if (m) {
      var left = evalBpValue(m[1]);
      var right = Number(m[3]);
      if (left === undefined) return false;
      if (m[2] === '==') return left == right;
      if (m[2] === '!=') return left != right;
      if (m[2] === '>') return left > right;
      if (m[2] === '<') return left < right;
      if (m[2] === '>=') return left >= right;
      if (m[2] === '<=') return left <= right;
    }
    var single = /^\s*([A-Za-z_]\w*)\s*$/.exec(expr);
    if (single) return !!evalBpValue(single[1]);
    return false;
  }
  function editBpCond(file, line) {
    if (!file || !line) return;
    var key = file + ':' + line;
    askModal('条件 / 日志断点 · ' + key, {
      msg: '条件：i == 10、count >= 3、P2 != 0xFF（满足才停）；日志：log:i,count（每次经过在控制台打印变量，不停下）。留空就是普通断点。',
      input: true, value: bpCondOf(key), ok: '保存'
    }).then(function (val) {
      if (val === null || val === undefined) return;
      var v = String(val).trim();
      if (v) bpConds[key] = v; else delete bpConds[key];
      saveBpConds();
      if (v && bpOf(file).indexOf(line) < 0) toggleBp(file, line);
      renderDebug();
      log(v ? ('已设置 ' + key + '：' + v) : ('已清除 ' + key + ' 的条件，按普通断点处理'), 'dim');
    });
  }

  function checkBp(v) {
    var loc = mapUnitLine(v.line);
    if (!loc || !loc.line) { lastStopKey = ''; return false; }
    var key = loc.file + ':' + loc.line;
    if (!bpSnap[key]) { lastStopKey = ''; return false; }
    if (key === lastStopKey) return false;
    var cond = bpCondOf(key);
    if (cond) {
      if (/^log\s*:/i.test(cond)) {
        var names = cond.replace(/^log\s*:/i, '').split(',');
        var parts = [];
        for (var ni = 0; ni < names.length; ni++) {
          var nm = names[ni].trim();
          if (!nm) continue;
          var val = evalBpValue(nm);
          parts.push(nm + ' = ' + (val === undefined ? '未定义' : val));
        }
        log('[日志断点] ' + key + ' · ' + parts.join('，'), 'dim');
        return false;
      }
      if (!evalBpCond(cond)) return false;   /* 条件不满足：当没这个断点，继续跑 */
      log('条件断点命中：' + key + '（' + cond + '）', 'dim');
    }
    lastStopKey = key;
    return true;
  }
  if (gutter && gutter.addEventListener) {
    gutter.addEventListener('click', function (e) {
      var t = e && e.target;
      while (t && t !== gutter && !(t.dataset && t.dataset.l)) t = t.parentNode;
      if (!t || t === gutter) return;
      var ln = parseInt(t.dataset.l, 10);
      if (ln) {
        if (e.shiftKey) editBpCond(project.active, ln);
        else toggleBp(project.active, ln);
      }
    });
  }

  /* ==================== 输出区折叠：默认只留一行状态条 ==================== */
  var buildPanelEl = $('build-panel'), buildToggleEl = $('btn-build-toggle');
  function buildCollapsed() {
    return !!(buildPanelEl && buildPanelEl.classList && buildPanelEl.classList.contains && buildPanelEl.classList.contains('collapsed'));
  }
  function setBuildCollapsed(on) {
    if (!buildPanelEl || !buildPanelEl.classList) return;
    if (buildPanelEl.classList.toggle) buildPanelEl.classList.toggle('collapsed', !!on);
    if (buildToggleEl) {
      buildToggleEl.textContent = on ? '展开' : '收起';
      if (buildToggleEl.setAttribute) buildToggleEl.setAttribute('aria-expanded', on ? 'false' : 'true');
      buildToggleEl.title = on ? '展开输出区，看完整编译日志' : '收起输出区，把空间让给代码';
    }
    try { localStorage.setItem('c51.buildCollapsed', on ? '1' : '0'); } catch (e) {}
  }
  /* 手动 Watch：回车或点 ＋ 添加，点 × 移除 */
  (function bindWatchAdd() {
    var input = $('watch-input');
    var btn = $('btn-watch-add');
    function commit() {
      if (!input) return;
      addWatchExpr(input.value);
      input.value = '';
      input.focus();
    }
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    if (btn) btn.addEventListener('click', commit);
    var host = $('watch');
    if (host) host.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var name = t.getAttribute('data-watch-del');
      if (name) removeWatchExpr(decodeURIComponent(name));
    });
  })();

  if (buildToggleEl) buildToggleEl.onclick = function () { setBuildCollapsed(!buildCollapsed()); };
  setBuildCollapsed((function () {
    try {
      var v = localStorage.getItem('c51.buildCollapsed');
      return v === null || v === undefined ? true : v === '1';
    } catch (e) { return true; }
  })());

  /* ==================== 调试面板 ==================== */
  var bottomTab = 'build';
  var lastSerialLen = -1;
  function setBottomTab(name) {
    bottomTab = name;
    var tabs = $('bottom-tabs');
    if (tabs && tabs.querySelectorAll) {
      var bs = tabs.querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) {
        var on = bs[i].dataset && bs[i].dataset.tab === name;
        if (bs[i].classList) { if (on) bs[i].classList.add('on'); else bs[i].classList.remove('on'); }
      }
    }
    var b = $('build-log'), d = $('debug-view'), se = $('serial-view');
    if (b) b.hidden = name !== 'build';
    if (d) d.hidden = name !== 'debug';
    if (se) se.hidden = name !== 'serial';
    if (name === 'debug') renderDebug();
    if (name === 'serial') { lastSerialLen = -1; renderSerial(); }
  }

  /* 串口监视器：程序每写一次 SBUF，这里就多一个字符 */
  function renderSerial() {
    var el = $('serial-out');
    if (!el) return;
    var raw = vm ? (vm.serial || '') : '';
    var text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (el.textContent !== text) {
      el.textContent = text || '（串口还没有输出）';
      el.scrollTop = el.scrollHeight;
    }
    lastSerialLen = raw.length;
  }
  $('btn-serial-clear').onclick = function () {
    if (vm) { vm.serial = ''; vm.serialDirty = false; }
    lastSerialLen = -1;
    renderSerial();
  };
  /* 串口发送：把文本逐字节塞进接收队列，程序读到 RI 就能从 SBUF 拿到 */
  function sendSerial() {
    var inp = $('serial-tx');
    var text = inp ? inp.value : '';
    if (!text) return;
    if (!vm || state !== 'running') {
      log('程序没在运行——先点「运行」，收到的字节才会进 SBUF。', 'warn');
      return;
    }
    for (var i = 0; i < text.length; i++) vm.receive(text.charCodeAt(i) & 0xFF);
    log('已向板子发送 ' + text.length + ' 个字节（进 SBUF 并置 RI；程序开了 ES 会进 interrupt 4）。', 'dim');
    inp.value = '';
  }
  var btnSerialSend = $('btn-serial-send');
  if (btnSerialSend) btnSerialSend.onclick = sendSerial;
  var serialTx = $('serial-tx');
  if (serialTx) serialTx.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); sendSerial(); }
  });
  function fmtLoc(n) {
    var loc = mapUnitLine(n);
    if (!loc) return '第 ' + n + ' 行';
    return loc.file + ' · 第 ' + loc.line + ' 行';
  }
  function renderDebug() {
    var st = $('dbg-state');
    if (st) {
      var loc0 = vm ? mapUnitLine(vm.line) : null;
      var at = loc0 && loc0.line ? fmtLoc(vm.line) : '';
      if (!vm) st.textContent = '还没运行。按 F5 运行，或点工具栏的播放键。';
      else if (vm.error) st.textContent = '出错：' + vm.error;
      else if (state === 'running') st.textContent = '运行中 · ' + at;
      /* 停在断点可能发生在第一条语句之前（函数入口），这时 stepCount 还是 0，
         不能落到「还没开始执行」那个分支，否则断点位置就看不出来了 */
      else if (state === 'paused') st.textContent = (pausedAtBp ? '停在断点 · ' : '已暂停 · ') + at;
      else if (!vm.stepCount) st.textContent = '已就绪 · 还没开始执行（F5 运行，F10 单步越过）';
      else if (vm.done) st.textContent = '程序已结束。';
      else st.textContent = (pausedAtBp ? '停在断点 · ' : '已暂停 · ') + at;
      if (hasUserDelay) st.textContent += '  ·  Delay() 由仿真器加速，内部断点不命中';
    }
    var host = $('callstack');
    if (host) {
      host.innerHTML = '';
      if (!vm || !vm.frames || !vm.frames.length) {
        host.innerHTML = '<div class="empty">没有正在执行的函数</div>';
      } else {
        for (var i = vm.frames.length - 1; i >= 0; i--) {
          (function (idx) {
            var f = vm.frames[idx];
            var top = idx === vm.frames.length - 1;
            var loc = mapUnitLine(top ? vm.line : f.callLine);
            var row = document.createElement('div');
            row.className = 'row' + (top ? ' top' : '');
            var fn = document.createElement('span');
            fn.className = 'fn';
            fn.textContent = (f.fn || '?') + '()';
            var lc = document.createElement('span');
            lc.className = 'loc';
            lc.textContent = loc ? loc.file + ':' + loc.line : '';
            row.appendChild(fn);
            row.appendChild(lc);
            row.addEventListener('click', function () {
              if (loc && loc.file) gotoFileLine(loc.file, loc.line);
            });
            host.appendChild(row);
          })(i);
        }
      }
    }
    var bph = $('bp-list');
    if (bph) {
      bph.innerHTML = '';
      var items = [];
      Object.keys(breakpoints).forEach(function (f) {
        (breakpoints[f] || []).forEach(function (l) { items.push([f, l]); });
      });
      items.sort(function (a, b) { return a[0] === b[0] ? a[1] - b[1] : (a[0] < b[0] ? -1 : 1); });
      if (!items.length) {
        bph.innerHTML = '<div class="empty">还没有断点。点行号就能加。</div>';
      } else {
        items.forEach(function (it) {
          var row = document.createElement('div');
          row.className = 'row';
          var nm = document.createElement('span');
          nm.className = 'fn';
          var condText = bpCondOf(it[0] + ':' + it[1]);
          nm.textContent = it[0] + ':' + it[1] + (condText ? '（' + condText + '）' : '');
          var x = document.createElement('span');
          x.className = 'x';
          x.textContent = '\u00d7';
          row.appendChild(nm);
          row.appendChild(x);
          row.addEventListener('click', function () { gotoFileLine(it[0], it[1]); });
          x.addEventListener('click', function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            toggleBp(it[0], it[1]);
          });
          bph.appendChild(row);
        });
      }
    }
  }

  /* ==================== 单步：进入 / 越过 / 跳出 ==================== */
  function advanceUntil(pred, maxSteps) {
    var budget = maxSteps || 20000, steps = 0;
    while (budget > 0 && vm && !vm.done && !vm.error) {
      var r = vm.pump(1, 1e9, pred);
      steps += r.steps;
      budget -= r.steps;
      if (r.stopped) return { steps: steps, stopped: true, timeout: false };
      if (!r.steps) break;
    }
    return { steps: steps, stopped: false, timeout: budget <= 0 };
  }

  function focusVmLine() {
    var loc = mapUnitLine(vm.line);
    if (loc && loc.file && loc.file !== project.active) openFile(loc.file);
    refreshGutter();
    markLine(loc && loc.file === project.active ? loc.line : 0);
    paintMarks();
    /* 停在长文件靠后的位置时，把它滚到视野中间 */
    if (loc && loc.line && loc.file === project.active) {
      var top = (loc.line - 1) * LINE_H;
      if (top < codeEl.scrollTop || top > codeEl.scrollTop + codeEl.clientHeight - LINE_H * 2) {
        codeEl.scrollTop = Math.max(0, top - codeEl.clientHeight / 2);
        syncCodeScroll();
      }
    }
  }

  function reportRunError() {
    log(vm.error, 'err');
    var loc = mapUnitLine(vm.line);
    errFile = loc ? loc.file : (project.active || '');
    errLine = loc ? loc.line : (vm.line || 0);
    refreshGutter();
    paintMarks();
    buildLine((errFile || 'main.c') + '(' + errLine + '): run error: ' + vm.error, 'err', errLine, errFile);
    addRunProblem(vm.error, errFile, errLine);
    setBuildSum('运行出错', 'err');
    state = 'stopped';
    pausedAtBp = false;
    setStatus('error', '运行出错');
    renderDebug();
  }

  function doStep(mode) {
    if (curPage === 'board' && boardView === 'pin') { postHw({ type: 'hw:step' }); return; }
    if (curPage === 'board' && boardView !== 'native') { setBoardHint('这个视图不运行代码', true); return; }
    if (state === 'running') state = 'paused';
    if (!vm || vm.done || state === 'stopped' || !vm.frames.length) {
      if (!build()) return;
    }
    if (!vm) return;
    pausedAtBp = false;
    var depth = vm.frames.length;
    var res = { steps: 0, stopped: false, timeout: false };
    if (mode === 'in') res = advanceUntil(function () { return true; }, 1);
    else if (mode === 'over') res = advanceUntil(function (v) { return v.frames.length <= depth; }, 60000);
    else res = advanceUntil(function (v) { return v.frames.length < depth; }, 120000);

    if (vm.error) {
      reportRunError();
    } else if (vm.done) {
      state = 'stopped';
      setStatus('stopped', '已结束');
      log('程序执行完毕。', 'dim');
      paintMarks();
      renderDebug();
    } else {
      state = 'paused';
      setStatus('paused', '已暂停');
      focusVmLine();
      if (res.timeout) log('这一步跑了很久还没走完，先停在这里。', 'dim');
      renderDebug();
    }
    render();
    updateButtons();
  }

  if ($('btn-step')) $('btn-step').onclick = function () { doStep('in'); };
  if ($('btn-step-over')) $('btn-step-over').onclick = function () { doStep('over'); };
  if ($('btn-step-out')) $('btn-step-out').onclick = function () { doStep('out'); };
  if ($('bottom-tabs') && $('bottom-tabs').addEventListener) {
    $('bottom-tabs').addEventListener('click', function (e) {
      var t = e && e.target;
      if (t && t.dataset && t.dataset.tab) { setBuildCollapsed(false); setBottomTab(t.dataset.tab); }
    });
  }
  if ($('proj-tabs') && $('proj-tabs').addEventListener) {
    $('proj-tabs').addEventListener('click', function (e) {
      var t = e && e.target;
      if (t && t.dataset && t.dataset.ptab) setProjTab(t.dataset.ptab);
    });
  }
  if (codeEl && codeEl.addEventListener) {
    codeEl.addEventListener('click', function (e) {
      if (e && (e.ctrlKey || e.metaKey)) { gotoDefinition(); }
    });
  }

  /* ==================== 快捷键 ==================== */
  window.addEventListener('keydown', function (e) {
    if (!e) return;
    var t = e.target;
    var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    var inFind = t && t.id && /^find-|^replace-/.test(t.id);
    var mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === 'f' || e.key === 'F') && !inFind) {
      e.preventDefault();
      openFind();
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      $('btn-run').onclick();
      return;
    }
    if (e.key === 'F9' && !inField) {
      e.preventDefault();
      toggleBp(project.active, currentLocalLine());
      return;
    }
    if (e.key === 'F10') {
      e.preventDefault();
      doStep('over');
      return;
    }
    if (e.key === 'F11') {
      e.preventDefault();
      doStep(e.shiftKey ? 'out' : 'in');
      return;
    }
    if (e.key === 'F12') {
      e.preventDefault();
      gotoDefinition();
      return;
    }
    if (mod && (e.key === 'z' || e.key === 'Z') && !inFind) {
      e.preventDefault();
      if (e.shiftKey) histRedo(); else histUndo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y') && !inFind) {
      e.preventDefault();
      histRedo();
      return;
    }
    if (e.key === 'Escape' && findBar && !findBar.hidden) {
      e.preventDefault();
      closeFind();
      return;
    }
    if (e.key === 'Escape' && $('dlg-keys') && $('dlg-keys').classList.contains('on')) {
      e.preventDefault();
      closeKeys();
      return;
    }
  });

  /* ---------------- 构建 / 运行 ---------------- */
  function build() {
    clearBuild();
    buildLine('Build target \'STC89C52RC\'  (仿真解释器，不是真正的 C51 编译器)', 'dim');
    var unit;
    try {
      unit = buildProgram();
    } catch (e) {
      buildLine('error: 工程读取失败 ' + (e && e.message ? e.message : e), 'err');
      setBuildSum('1 Error(s)', 'err');
      return false;
    }
    lastUnit = unit;
    var srcPaths = unit.units.map(function (u) { return u.path; });
    unit.units.forEach(function (u) {
      var bad = unit.errors.filter(function (er) { return er.file === u.path; }).length;
      buildLine('compiling ' + u.path + (bad ? '   (' + bad + ' error)' : ''), bad ? 'err' : 'dim');
    });
    if (srcPaths.length > 1) buildLine('compiling ' + srcPaths.length + ' file(s) 完成', 'dim');
    if (unit.errors.length) {
      unit.errors.forEach(function (er) {
        addProblem('error', er.file, er.line, er.msg);
      });
      renderProblems();
      buildLine('error: ' + unit.errors.length + ' 个错误，详见上方问题列表（点一行可跳转）', 'err');
      setBuildSum(unit.errors.length + ' Error(s)', 'err');
      setStatus('error', '编译失败');
      return false;
    }
    buildLine('linking...', 'dim');
    if (unit.warnings.length) {
      unit.warnings.forEach(function (w) {
        addProblem('warn', w.file, w.line, w.msg);
      });
      renderProblems();
      buildLine('warning: ' + unit.warnings.length + ' 条警告，详见上方问题列表', 'warn');
    }
    try {
      hw = C51HW.createHardware();
      hw.bounce.on = bounceOn;
      vm = new C51.VM('', hw, unit.ast);
      rebuildBpKeys();
      hw.syncAll(vm);
      resetRenderCache();
      reapplyMatrix();
      lastGutterLine = -1;
      errLine = 0;
      errFile = '';
      var nFunc = 0, nVar = 0;
      (vm.ast && vm.ast.body ? vm.ast.body : []).forEach(function (d) {
        if (d.t === 'func') nFunc++;
        else if (d.t === 'var') nVar++;
      });
      var total = 0;
      project.files.forEach(function (f) { total += String(f.content).split('\n').length; });
      buildLine('OK   语法检查通过 · ' + nFunc + ' 个函数 · ' + nVar + ' 个全局变量 · '
        + total + ' 行 · ' + unit.count + ' 个文件', 'ok');
      /* 教学诚实性：讲义例程都自己写了 Delay()，但内置加速版会覆盖它。
         不说明的话，学生会以为双层空循环真的在跑、断点为什么永远不命中。 */
      hasUserDelay = (vm.ast && vm.ast.body ? vm.ast.body : []).some(function (d) {
        return d.t === 'func' && (d.name === 'Delay' || d.name === 'DelayMs');
      });
      if (hasUserDelay) {
        buildLine('note: 你定义了 Delay()；为让仿真跑得动，内置加速版会覆盖它——'
          + '函数体不执行、打在它内部的断点不会命中，虚拟时间仍按毫秒推进。真板上你的代码正常生效。', 'warn');
      }
      var irqFns = (vm.ast && vm.ast.body ? vm.ast.body : []).filter(function (d) {
        return d.t === 'func' && d.interrupt != null && d.interrupt !== '';
      });
      if (irqFns.length) {
        buildLine('note: 已按 12MHz 模拟中断——定时器按 1 个机器周期 = 1μs 计数，溢出时自动调用 interrupt '
          + irqFns.map(function (d) { return d.interrupt; }).join(' / ') + ' 函数并自动清 TF 标志；'
          + '外部中断按 K3(P3.2)/K4(P3.3) 电平变化触发；串口写 SBUF 立即发送完成，'
          + '收到的字节放进 SBUF 并置 RI（开 ES 就进 interrupt 4）。', 'dim');
        var unk = irqFns.filter(function (d) {
          var n = +d.interrupt; return n < 0 || n > 4;
        }).map(function (d) { return d.interrupt; });
        if (unk.length) {
          buildLine('note: interrupt ' + unk.join(' / ') + ' 超出 STC89C52 的 0~4 号中断向量，'
            + '本仿真不会触发（支持 0/2 外部中断、1/3 定时器、4 串口）。', 'warn');
        }
      }
      var nw = unit.warnings.length;
      /* 编译通过后，再补几条"新手最容易踩"的静态提醒 */
      if (typeof lintTips === 'function') {
        var srcAll = '';
        if (project && project.files) {
          for (var pi = 0; pi < project.files.length; pi++) srcAll += '\n' + (project.files[pi].content || '');
        }
        var tips = lintTips(srcAll);
        for (var ti = 0; ti < tips.length; ti++) {
          buildLine('hint: ' + tips[ti], 'warn');
          addProblem('warn', project.active || '', 0, tips[ti]);
          nw++;
        }
        if (tips.length) renderProblems();
      }
      buildLine('0 Error(s), ' + nw + ' Warning(s)', nw ? 'warn' : 'ok');
      setBuildSum('0 Error(s), ' + nw + ' Warning(s)', nw ? 'warn' : 'ok');
      setStatus('stopped', '已就绪');
      paintCode();
      paintMarks();
      refreshGutter();
      pausedAtBp = false;
      lastStopKey = '';
      forceRender = true;
      /* 每次 build 都会新建硬件对象，等于这次运行的波形已清空；
         让时序图立刻回到空态，别把上一次的波形留着误导。 */
      lastScopeT = -1;
      lastScopeState = '';
      scopeHoverT = null;
      scopeCursorA = scopeCursorB = null;
      autoSpan();
      if (curPage === 'scope') drawScope();
      if (bottomTab === 'serial') { lastSerialLen = -1; renderSerial(); }
      renderDebug();
      return true;
    } catch (e) {
      vm = null;
      hasUserDelay = false;
      var msg = e && e.toString ? e.toString() : String(e);
      var uln = e && e.line ? e.line : 0;
      var loc = mapUnitLine(uln);
      var brief = msg.replace(/^第\s*\d+\s*行[：:]\s*/, '');
      errFile = loc ? loc.file : (project.active || '');
      errLine = loc ? loc.line : uln;
      var where = (errFile || 'main.c') + '(' + (errLine || '?') + ')';
      buildLine(where + ': error: ' + brief, 'err', errLine, errFile);
      var runHint = '';
      try { runHint = typeof diagnose === 'function' ? diagnose(brief) : ''; } catch (e) { runHint = ''; }
      if (runHint) buildLine('建议：' + runHint, 'warn');
      addProblem('error', errFile, errLine, brief);
      renderProblems();
      buildLine('1 Error(s), 0 Warning(s)', 'err');
      setBuildSum('1 Error(s)', 'err');
      log('编译未通过：' + msg + (loc ? '（' + loc.file + ' 第 ' + loc.line + ' 行）' : ''), 'err');
      setStatus('error', '编译错误');
      state = 'stopped';
      paintMarks();
      refreshGutter();
      renderDebug();
      updateButtons();
      return false;
    }
  }

  function setStatus(cls, text) {
    var s = $('status');
    s.className = 'status' + (cls === 'running' ? ' running' : cls === 'error' ? ' error' : '');
    s.textContent = text;
  }

  function updateButtons() {
    var label = $('btn-run-label') || $('btn-run');
    if (label) label.textContent = state === 'paused' ? '继续' : '运行';
    var p = $('btn-pause');
    if (p) p.disabled = state !== 'running';
  }

  function startRun() {
    /* 只有"暂停后继续"才沿用旧实例；其余情况都按当前代码重新构建 */
    if (state !== 'paused' || !vm || vm.done) { if (!build()) return; }
    if (!vm) return;
    state = 'running';
    pausedAtBp = false;
    setStatus('running', '运行中');
    updateButtons();
    renderDebug();
  }

  $('btn-run').onclick = function () { startRun(); updateButtons(); };
  $('btn-pause').onclick = function () {
    if (state === 'running') { state = 'paused'; setStatus('paused', '已暂停'); }
    forceRender = true;
    updateButtons();
    renderDebug();
  };
  $('btn-reset').onclick = function () {
    state = 'stopped';
    if (build()) { log('已复位：端口恢复高电平，程序回到 main 入口。', 'dim'); }
    updateButtons();
  };

  /* 引脚板视图下，主工具栏改为控制硬件页 */
  var nativeRunClick = $('btn-run').onclick;
  $('btn-run').onclick = function () {
    if (curPage === 'board' && boardView === 'pin') { hwRun(); return; }
    if (curPage === 'board' && boardView !== 'native') { setBoardHint('这个视图不运行代码', true); return; }
    nativeRunClick();
  };
  var nativePauseClick = $('btn-pause').onclick;
  $('btn-pause').onclick = function () {
    if (curPage === 'board' && boardView === 'pin') { postHw({ type: 'hw:pause' }); return; }
    if (curPage === 'board' && boardView !== 'native') return;
    nativePauseClick();
  };
  var nativeResetClick = $('btn-reset').onclick;
  $('btn-reset').onclick = function () {
    if (curPage === 'board' && boardView === 'pin') { postHw({ type: 'hw:reset' }); return; }
    if (curPage === 'board' && boardView !== 'native') return;
    nativeResetClick();
  };
  $('btn-clear').onclick = function () { consoleEl.innerHTML = ''; };
  $('btn-build').onclick = function () {
    var ok = build();
    log(ok ? '编译通过，没有语法错误。' : '编译没通过，看左下角“编译输出”里的错误行。', ok ? 'dim' : 'err');
    updateButtons();
  };
  $('btn-restore').onclick = function () {
    if (!curExample) return;
    var f = fileOf('main.c');
    if (!f) { f = { path: 'main.c', content: '' }; project.files.push(f); }
    f.content = curExample.code;
    if (project.active !== 'main.c') openFile('main.c');
    codeEl.value = curExample.code;
    project.open = project.open.indexOf('main.c') >= 0 ? project.open : ['main.c'].concat(project.open);
    renderTabs();
    renderTree();
    refreshGutter();
    paintCode();
    saveCode();
    build();
    updateButtons();
    log('已还原 main.c 为讲义「' + curExample.title + '」的原始代码（工程里其它文件保留）。', 'dim');
  };
  $('btn-format').onclick = function () {
    codeEl.value = codeEl.value.replace(/\t/g, '    ').replace(/[ \t]+$/gm, '');
    refreshGutter();
    saveCode();
    log('已把缩进统一成 4 个空格、并清掉行尾空白。', 'dim');
  };
  /* Ctrl + Enter（macOS 为 Cmd + Enter）：运行 / 暂停 */
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveAll();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      $('btn-run').onclick();
      return;
    }
    if (e.key === 'Escape') closeZoom();
  });

  /* ---------------- 放大看板（两级） ----------------
     在「写代码」页点它 = 跳到「开发板」页，板子跟着变大（不再浮一层盖住代码）；
     已经在「开发板」页再点 = 全屏铺满，Esc 或再点一次退出。
  ---------------------------------------------------------------- */
  var boardCard = $('board-card') || (function () {
    var el = $('board');
    while (el && el.parentNode) {
      if (String(el.className || '').indexOf('board-panel') >= 0) return el;
      el = el.parentNode;
    }
    return null;
  })();
  function isZoomed() {
    return !!(boardCard && boardCard.classList && boardCard.classList.contains
      && boardCard.classList.contains('board-full'));
  }
  function updateZoomLabel() {
    var b = $('btn-zoom');
    if (!b) return;
    var onBoard = curPage === 'board';
    b.textContent = isZoomed() ? '退出全屏' : (onBoard ? '全屏看板' : '放大看板');
    if (b.setAttribute) {
      b.setAttribute('title', isZoomed() ? '退出全屏（Esc）'
        : (onBoard ? '板子再铺满整个窗口' : '跳到「开发板」页，板子更大'));
      b.setAttribute('aria-pressed', isZoomed() ? 'true' : 'false');
    }
  }
  function closeZoom() {
    if (!isZoomed()) return;
    boardCard.classList.remove('board-full');
    if (document.body && document.body.classList) document.body.classList.remove('no-scroll');
    /* 页头/导航条的 z-index 在全屏面板的堆叠上下文之外，会盖住「退出全屏」按钮；
       全屏期间整体隐藏，退出时恢复。 */
    if (document.body && document.body.classList) document.body.classList.remove('zoomed');
    updateZoomLabel();
  }
  function openZoom() {
    if (!boardCard) return;
    boardCard.classList.add('board-full');
    if (document.body && document.body.classList) document.body.classList.add('no-scroll');
    if (document.body && document.body.classList) document.body.classList.add('zoomed');
    updateZoomLabel();
  }
  $('btn-zoom').onclick = function () {
    if (!boardCard) return;
    if (isZoomed()) { closeZoom(); return; }
    /* 第一下：先跳页；已经在开发板页了才铺满全屏，避免一上来就盖住整个界面 */
    if (curPage !== 'board') { setPage('board'); return; }
    openZoom();
  };
  updateZoomLabel();
  $('speed').oninput = function () {
    speed = parseFloat(this.value);
    $('speed-val').textContent = speed + '×';
    if (curPage === 'board' && boardView === 'pin') postHw({ type: 'hw:speed', speed: speed });
  };

  /* ---------------- 行号 ---------------- */
  function gutterCls(n) {
    var cls = '';
    if (errLine && (!errFile || errFile === project.active) && n === errLine) cls += ' err';
    if (isBp(project.active, n)) cls += ' bp';
    return cls;
  }
  function refreshGutter() {
    var n = codeEl.value.split('\n').length;
    var html = '';
    for (var i = 1; i <= n; i++) {
      var c = gutterCls(i);
      html += '<div data-l="' + i + '"' + (c ? ' class="' + c.trim() + '"' : '') + '>' + i + '</div>';
    }
    gutter.innerHTML = html;
    /* 重建行号会把滚动位置打回顶部：代码滚到中间时一打字行号就全错位，
       所以重建后立刻跟着 textarea 的滚动位置走。 */
    gutter.scrollTop = codeEl.scrollTop;
    lastGutterLine = -1;
  }
  codeEl.addEventListener('input', function () {
    var f = fileOf(project.active);
    if (f) f.content = codeEl.value;
    histRecord();
    refreshGutter(); paintCode(); saveCode(); updateCursor();
    /* 暂停时改代码会把当前行标记一起重建掉，补回来（运行中下一帧也会自己补） */
    if (state === 'running' || state === 'paused') markLine(vmLocalLine());
    acShow();
  });
  codeEl.addEventListener('scroll', function () {
    gutter.scrollTop = codeEl.scrollTop;
    syncCodeScroll();
    acClose();
  });
  codeEl.addEventListener('blur', acClose);
  ['click', 'keyup', 'select'].forEach(function (ev) {
    codeEl.addEventListener(ev, updateCursor);
  });
  /* ---------------- 编辑器按键：自动缩进 / 括号配对 / 块缩进 ----------------
     - 回车：继承光标所在行前导空白；行尾是 { 或是控制语句行
       (if/else/for/while/do/switch/case/default) 时多缩进一级；
       光标恰在 { 和 } 之间时拆成三行并把光标放在中间行
     - 输入 { ：在多缩一级的悬空行上打 { 时，自动退回与控制语句同级（Allman 风格）
     - 输入 } ：行首只有空白时，按配对 { 所在行的缩进精确对齐（括号配对扫描，
       连无括号的 if 单语句体也能直接对齐外层块）；找不到配对时退一级
     - 输入 ( [ { ' " ：自动补出配对字符；有选中时改为包围
     - 输入 ) ] } ：光标后已是配对字符则直接跳过（覆盖输入）
     - 退格：光标夹在空配对中间时两个一起删
     - Tab / Shift+Tab ：无选中插入 \t；多行选中整体缩进 / 反缩进
     所有程序化修改都走 applyEdit()，保证高亮层 / 行号 / 存档与输入事件同步。
  ------------------------------------------------------------------ */
  var PAIR_OPEN = { '(': ')', '[': ']', '{': '}' };
  /* 控制语句行：回车后应多缩一级（写无括号的单语句体） */
  var CTRL_PAREN = /^(if|for|while|switch)\s*\(.*\)$/;
  function isCtrlLine(line) {
    var t = line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    if (!t) return false;
    if (CTRL_PAREN.test(t)) return true;
    if (/^else(\s+if\s*\(.*\))?$/.test(t)) return true;
    if (t === 'do') return true;
    if (/^case\b.*:$/.test(t)) return true;
    if (/^default\s*:$/.test(t)) return true;
    return false;
  }
  /* 往上找最近一条非空行 */
  function prevNonEmptyLine(v, lsB) {
    var head = v.slice(0, Math.max(0, lsB - 1));
    while (head.length) {
      var nl = head.lastIndexOf('\n');
      var line = head.slice(nl + 1);
      if (line.trim() !== '') return line;
      if (nl < 0) break;
      head = head.slice(0, nl);
    }
    return null;
  }
  /* 扫描未闭合的 { ：返回最内层未闭合 { 的下标（跳过字符串/注释），没有则 -1 */
  function enclosingBracePos(text) {
    var stack = [], i = 0, n = text.length;
    while (i < n) {
      var c = text.charAt(i), d = text.charAt(i + 1);
      if (c === '/' && d === '/') { while (i < n && text.charAt(i) !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < n - 1 && !(text.charAt(i) === '*' && text.charAt(i + 1) === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") { i++; while (i < n && text.charAt(i) !== c) { if (text.charAt(i) === '\\') i++; i++; } i++; continue; }
      if (c === '{') stack.push(i);
      else if (c === '}' && stack.length) stack.pop();
      i++;
    }
    return stack.length ? stack[stack.length - 1] : -1;
  }
  /* ---------------- 自动补全 ---------------- */
  var acEl = null, acItems = [], acIndex = 0, acWord = { start: 0, end: 0 }, acMirror = null;

  function walkNodes(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (x) { walkNodes(x, fn); }); return; }
    fn(node);
    Object.keys(node).forEach(function (k) { walkNodes(node[k], fn); });
  }

  /* 符号表（自动补全用）：从 VM 的 AST 与内置名表收集，和上面的 collectSymbols 不是一回事 */
  function completionSymbols() {
    var seen = {}, list = [];
    function put(name, kind, detail) {
      if (!name || seen[name]) return;
      seen[name] = { name: name, kind: kind, detail: detail || '' };
      list.push(seen[name]);
    }
    var ast = vm && vm.ast;
    if (ast) {
      (ast.body || []).forEach(function (d) {
        if (d.t === 'func') {
          put(d.name, 'fn', '(' + (d.params || []).map(function (p) { return p.name || '?'; }).join(', ') + ')');
        }
      });
      walkNodes(ast, function (n) {
        if (n.t === 'globaldecl' || n.t === 'decl') {
          (n.vars || []).forEach(function (v) { put(v.name, n.t === 'decl' ? 'var' : 'gvar', ''); });
        } else if (n.t === 'sbit' || n.t === 'sfr') {
          put(n.name, 'reg', n.t);
        }
      });
    }
    (C51.builtinNames || []).forEach(function (n) { put(n, 'fn', '内置'); });
    (C51.sfrNames || []).forEach(function (n) { put(n, 'reg', 'SFR'); });
    (C51.bitNames || []).forEach(function (n) { put(n, 'reg', '位'); });
    project.files.forEach(function (f) {
      var re = /#\s*define\s+([A-Za-z_]\w*)/g, m;
      while ((m = re.exec(String(f.content || '')))) put(m[1], 'mac', '#define');
    });
    return list;
  }

  function acCaretPos() {
    var ta = codeEl;
    if (!acMirror) {
      acMirror = document.createElement('div');
      acMirror.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:0;'
        + 'white-space:pre-wrap;word-wrap:break-word;overflow:hidden;';
      document.body.appendChild(acMirror);
    }
    var cs = window.getComputedStyle ? window.getComputedStyle(ta) : null;
    ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom',
      'paddingLeft', 'letterSpacing', 'tabSize'].forEach(function (p) {
      if (cs && cs[p]) acMirror.style[p] = cs[p];
    });
    acMirror.style.width = ta.clientWidth + 'px';
    acMirror.textContent = ta.value.slice(0, ta.selectionStart);
    var span = document.createElement('span');
    span.textContent = '\u200b';
    acMirror.appendChild(span);
    var lh = parseFloat((cs && cs.lineHeight) || 23) || 23;
    return {
      left: span.offsetLeft - ta.scrollLeft,
      top: span.offsetTop - ta.scrollTop + lh
    };
  }

  function acClose() {
    acItems = [];
    acIndex = 0;
    if (acEl) { acEl.hidden = true; acEl.innerHTML = ''; }
  }

  function acCurrentWord() {
    var v = codeEl.value, s = codeEl.selectionStart, e = codeEl.selectionEnd;
    if (s !== e) return null;
    var start = s;
    while (start > 0 && /[A-Za-z0-9_]/.test(v.charAt(start - 1))) start--;
    var word = v.slice(start, s);
    if (!word || !/^[A-Za-z_]/.test(word)) return null;
    var lineStart = v.lastIndexOf('\n', start - 1) + 1;
    var lineHead = v.slice(lineStart, start);
    if (lineHead.indexOf('//') >= 0 || /\/\*/.test(lineHead)) return null;
    return { start: start, end: s, word: word };
  }

  function acShow() {
    var info = acCurrentWord();
    if (!info) { acClose(); return; }
    var q = info.word.toLowerCase();
    var hits = completionSymbols().filter(function (it) {
      return it.name !== info.word && it.name.toLowerCase().indexOf(q) === 0;
    }).sort(function (a, b) {
      return a.name.length - b.name.length || cmpName(a.name, b.name);
    }).slice(0, 40);
    if (!hits.length) { acClose(); return; }
    acItems = hits;
    acIndex = 0;
    acWord = info;
    if (!acEl) acEl = $('ac');
    if (!acEl) return;
    acEl.innerHTML = '';
    hits.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'ac-item' + (i === 0 ? ' on' : '');
      var k = document.createElement('span');
      k.className = 'k';
      k.textContent = it.kind === 'fn' ? 'fn' : (it.kind === 'mac' ? 'def'
        : (it.kind === 'reg' ? 'reg' : 'var'));
      var n = document.createElement('span');
      var isSig = it.kind === 'fn' && it.detail && it.detail.charAt(0) === '(';
      n.textContent = it.name + (isSig ? it.detail : '');
      var d = document.createElement('span');
      d.className = 'd';
      d.textContent = isSig ? '' : it.detail;
      row.appendChild(k);
      row.appendChild(n);
      row.appendChild(d);
      row.addEventListener('mousedown', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        acIndex = i;
        acAccept();
      });
      acEl.appendChild(row);
    });
    var pos = acCaretPos();
    acEl.hidden = false;
    acEl.style.left = Math.max(4, Math.min(pos.left, (codeEl.clientWidth || 400) - 210)) + 'px';
    acEl.style.top = Math.min(pos.top, (codeEl.clientHeight || 300) - 214) + 'px';
  }

  function acMove(delta) {
    if (!acItems.length || !acEl) return;
    acIndex = (acIndex + delta + acItems.length) % acItems.length;
    Array.prototype.forEach.call(acEl.children, function (el, i) {
      el.className = 'ac-item' + (i === acIndex ? ' on' : '');
    });
  }

  function acAccept() {
    if (!acItems.length) return;
    var it = acItems[acIndex];
    var insert = it.name + (it.kind === 'fn' ? '(' : '');
    var next = codeEl.value.slice(0, acWord.start) + insert + codeEl.value.slice(acWord.end);
    var caret = acWord.start + insert.length;
    acClose();
    applyEdit(next, caret);
  }

  function applyEdit(v, s, e) {
    codeEl.value = v;
    codeEl.selectionStart = s;
    codeEl.selectionEnd = (e == null ? s : e);
    var f = fileOf(project.active);
    if (f) f.content = v;
    histRecord();
    refreshGutter(); paintCode(); saveCode(); updateCursor();
  }
  codeEl.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (acItems.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); acMove(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); acMove(-1); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(); return; }
      if (e.key === 'Escape') { e.preventDefault(); acClose(); return; }
    }
    var v = this.value, s = this.selectionStart, en = this.selectionEnd;

    /* --- Tab / Shift+Tab --- */
    if (e.key === 'Tab') {
      e.preventDefault();
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      var le = v.indexOf('\n', en); if (le < 0) le = v.length;
      var multi = v.slice(s, en).indexOf('\n') >= 0;
      if (!multi && !e.shiftKey) {
        applyEdit(v.slice(0, s) + '\t' + v.slice(en), s + 1);
      } else if (!multi && e.shiftKey) {
        var seg = v.slice(ls, le);
        var m = seg.match(/^\t/);
        var cut = m ? 1 : (seg.match(/^ {1,4}/) || [''])[0].length;
        if (!cut) return;
        applyEdit(v.slice(0, ls) + seg.slice(cut) + v.slice(le), Math.max(ls, s - cut));
      } else {
        var chunk = v.slice(ls, le);
        if (e.shiftKey) {
          /* 逐行回退一个缩进单位（\t 或最多 4 个空格） */
          var lines = chunk.split('\n');
          var removals = [], at = ls;
          for (var i = 0; i < lines.length; i++) {
            var one = lines[i].match(/^\t/) || lines[i].match(/^ {1,4}/);
            if (one && one[0].length) {
              removals.push({ at: at, n: one[0].length });
              lines[i] = lines[i].slice(one[0].length);
            }
            at += lines[i].length + 1;
          }
          var rebuilt = lines.join('\n');
          /* 依据各次行首删除量平移光标/选区 */
          function shiftPos(p) {
            var d = p;
            for (var j = 0; j < removals.length; j++) {
              var r = removals[j];
              if (r.at + r.n <= p) d -= r.n;
              else if (r.at < p) d -= (p - r.at);
            }
            return d;
          }
          applyEdit(v.slice(0, ls) + rebuilt + v.slice(le), shiftPos(s), shiftPos(en));
        } else {
          var nv2 = v.slice(0, ls) + chunk.replace(/^/gm, '\t') + v.slice(le);
          var nl = chunk.split('\n').length;
          applyEdit(nv2, s + 1, en + nl);
        }
      }
      return;
    }

    /* --- Ctrl+/ ：整行注释切换 --- */
    if (e.key === '/' && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      var cLs = v.lastIndexOf('\n', s - 1) + 1;
      var cLe = v.indexOf('\n', en); if (cLe < 0) cLe = v.length;
      var cLines = v.slice(cLs, cLe).split('\n');
      /* 只要有一行没注释就整体加注释，全有注释才整体取消 */
      var allC = cLines.every(function (l) {
        var t = l.replace(/^[ \t]+/, '');
        return t === '' || t.slice(0, 2) === '//';
      });
      var edits = [];
      var out = cLines.map(function (l, idx) {
        var t = l.replace(/^[ \t]+/, '');
        if (t === '') return l;
        var ind = l.match(/^[ \t]*/)[0].length;
        var at = cLs;
        for (var j = 0; j < idx; j++) at += cLines[j].length + 1;
        if (allC) {
          var m2 = l.slice(ind).match(/^\/\/ ?/);
          var del = m2 ? m2[0].length : 0;
          edits.push({ at: at + ind, del: del, ins: 0 });
          return l.slice(0, ind) + l.slice(ind + del);
        }
        edits.push({ at: at + ind, del: 0, ins: 3 });
        return l.slice(0, ind) + '// ' + l.slice(ind);
      });
      var adjC = function (p) {
        var d = p;
        for (var j = 0; j < edits.length; j++) {
          var e2 = edits[j];
          if (e2.at < p) d += (e2.ins - Math.min(e2.del, p - e2.at));
        }
        return d;
      };
      applyEdit(v.slice(0, cLs) + out.join('\n') + v.slice(cLe), adjC(s), adjC(en));
      return;
    }

    /* --- 回车：自动缩进 --- */
    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      var before = v.slice(0, s), after = v.slice(en);
      var ls2 = before.lastIndexOf('\n') + 1;
      var lead = (before.slice(ls2).match(/^[ \t]*/) || [''])[0];
      var cur = before.slice(ls2);
      /* 只看光标所在这一行：行尾是 { 或控制语句（if/else/for/while/do/switch/case）
         才多缩一级；不能拿整段 before 判断，否则 { 后的空行上按回车
         会被误判成“刚打完 {”而多缩一级 */
      var openBrace = /\{\s*$/.test(cur);
      var ctrl = !openBrace && isCtrlLine(cur);
      var unit = (lead.indexOf('\t') >= 0 || lead === '') ? '\t' : '    ';
      var closeNext = after.charAt(0) === '}';
      if (openBrace && closeNext) {
        /* 在 { 和 } 之间回车：拆成三行，光标放中间 */
        var ins = '\n' + lead + unit + '\n' + lead;
        applyEdit(v.slice(0, s) + ins + v.slice(en), s + 1 + lead.length + unit.length);
      } else if (openBrace || ctrl) {
        applyEdit(v.slice(0, s) + '\n' + lead + unit + v.slice(en), s + 1 + lead.length + unit.length);
      } else {
        applyEdit(v.slice(0, s) + '\n' + lead + v.slice(en), s + 1 + lead.length);
      }
      return;
    }

    /* --- 退格：删除空配对 --- */
    if (e.key === 'Backspace' && s === en && s > 0) {
      var prev = v.charAt(s - 1), nxt = v.charAt(s);
      if ((PAIR_OPEN[prev] && PAIR_OPEN[prev] === nxt) || ((prev === '"' || prev === "'") && prev === nxt)) {
        e.preventDefault();
        applyEdit(v.slice(0, s - 1) + v.slice(s + 1), s - 1);
      }
      return;
    }

    var ch = (e.key && e.key.length === 1) ? e.key : null;
    if (!ch) return;

    /* --- 覆盖输入：光标后已是配对字符则跳过 --- */
    if (s === en && (ch === ')' || ch === ']' || ch === '}' || ch === '"' || ch === "'") && v.charAt(s) === ch) {
      e.preventDefault();
      this.selectionStart = this.selectionEnd = s + 1;
      updateCursor();
      return;
    }

    /* --- 输入 { ：在多缩一级的悬空行上自动回到控制语句同级（Allman 风格） --- */
    if (ch === '{' && s === en) {
      var lsB = v.lastIndexOf('\n', s - 1) + 1;
      var leadB = v.slice(lsB, s);
      if (leadB && /^[ \t]+$/.test(leadB)) {
        var pl = prevNonEmptyLine(v, lsB);
        if (pl !== null && isCtrlLine(pl)) {
          var pLead = (pl.match(/^[ \t]*/) || [''])[0];
          if (pLead.length < leadB.length) {
            applyEdit(v.slice(0, lsB) + pLead + '{}' + v.slice(s), lsB + pLead.length + 1);
            e.preventDefault();
            return;
          }
        }
      }
    }

    /* --- 电致回退：在只有空白的行首输入 } 时对齐配对 { 所在行 --- */
    if (ch === '}' && s === en) {
      var ls3 = v.lastIndexOf('\n', s - 1) + 1;
      var lead3 = v.slice(ls3, s);
      if (/^[ \t]+$/.test(lead3)) {
        /* 按未闭合的 { 找目标缩进：无括号 if 体后的 } 也能直接对齐外层块 */
        var bp = enclosingBracePos(v.slice(0, ls3));
        var tLead = null;
        if (bp >= 0) {
          var bl = v.lastIndexOf('\n', bp - 1) + 1;
          tLead = (v.slice(bl).match(/^[ \t]*/) || [''])[0];
        }
        if (tLead !== null && tLead !== lead3) {
          applyEdit(v.slice(0, ls3) + tLead + '}' + v.slice(s), ls3 + tLead.length + 1);
          e.preventDefault();
          return;
        }
        if (tLead === null) {
          var unit3 = lead3.match(/(\t| {1,4})$/);
          if (unit3) {
            var cut3 = lead3.length - unit3[1].length;
            applyEdit(v.slice(0, ls3 + cut3) + '}' + v.slice(s), ls3 + cut3 + 1);
            e.preventDefault();
            return;
          }
        }
      }
    }

    /* --- 自动配对 / 包围 --- */
    if (PAIR_OPEN[ch] || ch === '"' || ch === "'") {
      var close = PAIR_OPEN[ch] || ch;
      if (s !== en) {
        applyEdit(v.slice(0, s) + ch + v.slice(s, en) + close + v.slice(en), s + 1, en + 1);
      } else if (ch === '"' || ch === "'") {
        /* 前面是标识符字符时不自动配对（如输入 don't 这类场景） */
        if (/[A-Za-z0-9_]/.test(v.charAt(s - 1))) return;
        applyEdit(v.slice(0, s) + ch + close + v.slice(s), s + 1);
      } else {
        applyEdit(v.slice(0, s) + ch + close + v.slice(s), s + 1);
      }
      e.preventDefault();
      return;
    }
  });

  function markLine(line) {
    if (line === lastGutterLine) return;
    lastGutterLine = line;
    paintMarks();
    var rows = gutter.children;
    for (var i = 0; i < rows.length; i++) {
      var n = +rows[i].dataset.l;
      var cls = gutterCls(n);
      if (n === line) cls = (cls ? cls + ' ' : '') + 'cur';
      rows[i].className = cls;
    }
  }

  /* ---------------- 按键抖动 ----------------
     真实按键在按下/松开的瞬间电平会来回跳几毫秒。
     打开后 hw.readPort 在抖动窗口内返回乱跳的 P3 值，用来检验消抖代码。
  ------------------------------------------------------------------ */
  var bounceOn = false;
  if ($('btn-bounce')) $('btn-bounce').onclick = function () {
    bounceOn = !bounceOn;
    this.textContent = '抖动 ' + (bounceOn ? '开' : '关');
    if (hw && hw.bounce) hw.bounce.on = bounceOn;
    log(bounceOn
      ? '已开启按键抖动：每次按下/松开后的 5~20ms 内电平会乱跳（5V 板子上真实按键就是这样），看看你的消抖代码还管不管用。'
      : '已关闭按键抖动：按键电平干净切换，等同理想按键。', bounceOn ? 'warn' : 'dim');
  };

  /* ---------------- 蜂鸣器声音 ---------------- */
  var soundOn = false, actx = null, osc = null, gain = null, lastFlips = 0;
  $('btn-sound').onclick = function () {
    soundOn = !soundOn;
    this.textContent = '声音 ' + (soundOn ? '开' : '关');
    if (soundOn && !actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        osc = actx.createOscillator();
        gain = actx.createGain();
        osc.type = 'square';
        osc.frequency.value = 1000;
        gain.gain.value = 0;
        osc.connect(gain); gain.connect(actx.destination);
        osc.start();
      } catch (e) { log('当前浏览器不支持音频输出，只显示蜂鸣器动画。', 'dim'); soundOn = false; this.textContent = '声音 关'; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  };
  function updateSound() {
    /* 翻转次数要一直更新：render() 用它判断蜂鸣器要不要亮，不能只在开声音时维护 */
    var flips = hw ? hw.buzzer.flips : 0;
    if (!gain) { lastFlips = flips; return; }
    var active = false, freq = 0;
    if (soundOn && vm && hw && state === 'running') {
      var gap = hw.buzzer.lastFlip - hw.buzzer.prevFlip;
      /* 最近一次翻转还在 120ms 内、且相邻两次翻转的间隔够短，才算真的在发声 */
      active = gap > 0.05 && gap < 100 && (vm.vtime - hw.buzzer.lastFlip) < 120;
      /* 声音跟着程序的翻转频率走：半周期 gap(ms) → 频率 1000/(2·gap) Hz。
         软件延时、定时器中断改一下，音高就跟着变；超出人耳/扬声器范围时夹住。 */
      if (active) freq = Math.max(20, Math.min(8000, 1000 / (2 * gap)));
    }
    lastFlips = flips;
    if (osc && freq) osc.frequency.value = freq;
    gain.gain.value = active ? 0.04 : 0;
  }

  /* ---------------- 渲染 ----------------
     只有「正在运行」或明确要求重绘（forceRender）时才碰 DOM。
     以前每帧无条件写 80 多个属性，闲着也跑满 60fps；现在停着就完全不写。
  ------------------------------------------------------------------ */
  var forceRender = false;
  /* 渲染缓存：值没变就不写 DOM，避免每帧几百次重复 setAttribute */
  var rLed = [], rSeg = [], rLcd = ['', ''], rPortHex = {}, rPortBits = {},
      rBuzzerFill = null, rBuzzerText = null, rVtime = null, rSteps = null;
  function resetRenderCache() {
    rLed = []; rSeg = []; rLcd = ['', '']; rPortHex = {}; rPortBits = {};
    rBuzzerFill = null; rBuzzerText = null; rVtime = null; rSteps = null;
  }
  function render() {
    var i, b;
    for (i = 0; i < 8; i++) {
      var on = hw && hw.leds[i] ? 1 : 0;
      if (rLed[i] !== on) {
        rLed[i] = on;
        ledEls[i].setAttribute('fill', on ? '#ff3a22' : '#7d3a30');
        ledHalo[i].setAttribute('opacity', on ? 0.38 : 0);
      }
    }
    for (i = 0; i < 8; i++) {
      var code = 0;
      if (hw && vm && (vm.vtime - hw.nixieTime[i]) < 40) code = hw.nixie[i];
      if (rSeg[i] === code) continue;
      rSeg[i] = code;
      for (var s = 0; s < 7; s++) {
        var lit = (code >> s) & 1;
        segEls[i][SEG_ORDER[s]].setAttribute('fill', lit ? '#ff3d1e' : '#5c6057');
      }
      dpEls[i].setAttribute('fill', ((code >> 7) & 1) ? '#ff3d1e' : '#5c6057');
    }
    if (hw) {
      var lines = hw.lcdText();
      if (rLcd[0] !== lines[0]) { rLcd[0] = lines[0]; lcdLines[0].textContent = lines[0]; }
      if (rLcd[1] !== lines[1]) { rLcd[1] = lines[1]; lcdLines[1].textContent = lines[1]; }
      var buzzing = state === 'running' && hw.buzzer.flips - lastFlips > 0;
      var fill = buzzing ? '#f0b429' : '#333941';
      if (rBuzzerFill !== fill) { rBuzzerFill = fill; buzzerEl.setAttribute('fill', fill); }
      var btext = '蜂鸣器 翻转 ' + hw.buzzer.flips + ' 次';
      if (rBuzzerText !== btext) { rBuzzerText = btext; buzzerText.textContent = btext; }
    }
    if (vm) {
      ['P0', 'P1', 'P2', 'P3'].forEach(function (p) {
        var v = vm.ports[p];
        var hex = '0x' + ('0' + v.toString(16).toUpperCase()).slice(-2);
        if (rPortHex[p] !== hex) { rPortHex[p] = hex; portHex[p].textContent = hex; }
        if (rPortBits[p] === v) return;
        rPortBits[p] = v;
        for (b = 0; b < 8; b++) {
          var bit = (v >> b) & 1;
          var el = portBits[p][b];
          el.textContent = bit;
          el.className = 'bit ' + (bit ? 'one' : 'zero');
        }
      });
      var vt = vm.vtime.toFixed(0);
      if (rVtime !== vt) { rVtime = vt; $('vtime').textContent = vt + ' ms'; }
      if (rSteps !== vm.stepCount) { rSteps = vm.stepCount; $('steps').textContent = vm.stepCount + ' 条语句'; }
      if (state === 'running' || state === 'paused') markLine(vmLocalLine());
      else paintMarks();
    }
    renderWatch();
    updateSound();
  }

  /* ---------------- 主循环 ---------------- */
  var lastTs = 0, lastScopeT = -1, lastScopeState = '';
  function frame(ts) {
    var dt = lastTs ? Math.min(60, ts - lastTs) : 16;
    lastTs = ts;
    if (state === 'running' && vm && !vm.done) {
      var pr = vm.pump(3000, dt * speed, checkBp);
      if (pr.stopped) {
        state = 'paused';
        pausedAtBp = true;
        setStatus('paused', '断点');
        focusVmLine();
        var bloc = mapUnitLine(vm.line);
        log('停在断点：' + (bloc ? bloc.file + ' 第 ' + bloc.line + ' 行' : '第 ' + vm.line + ' 行'), 'dim');
        forceRender = true;
        renderDebug();
        setBottomTab('debug');
        updateButtons();
      } else if (vm.error) {
        log(vm.error, 'err');
        var rl = mapUnitLine(vm.line);
        errFile = rl ? rl.file : (project.active || '');
        errLine = rl ? rl.line : (vm.line || 0);
        refreshGutter();
        paintMarks();
        buildLine((errFile || 'main.c') + '(' + errLine + '): run error: ' + vm.error, 'err', errLine, errFile);
        addRunProblem(vm.error, errFile, errLine);
        setBuildSum('运行出错', 'err');
        state = 'stopped';
        setStatus('error', '运行出错');
        forceRender = true;
        updateButtons();
      } else if (vm.done) {
        log('程序执行完毕（main 已返回）。想让程序一直跑，请在 main 里写 while(1)。', 'dim');
        state = 'stopped';
        setStatus('stopped', '已结束');
        forceRender = true;
        updateButtons();
      }
    }
    if (state === 'running' || forceRender) {
      render();
      forceRender = false;
    }
    /* 串口有新增输出就刷新监视器（只在串口标签打开时碰 DOM） */
    if (bottomTab === 'serial' && curPage === 'code' && vm && vm.serial.length !== lastSerialLen) {
      renderSerial();
    }
    /* 运行中随虚拟时间重画；状态切换（停止/暂停/断点）也重画一次，
       底部「本次运行已结束」才会跟着更新 */
    if (curPage === 'scope' && (!vm || vm.vtime !== lastScopeT || state !== lastScopeState)) {
      lastScopeT = vm ? vm.vtime : -1;
      lastScopeState = state;
      drawScope();
    }
    requestAnimationFrame(frame);
  }

  buildBoard();
  buildPorts();
  buildExamples();
  setPage('code');
  var hash = (typeof location !== 'undefined' && location.hash) || '';
  var m = /ex=([\w-]+)/.exec(hash);
  loadExample(m ? m[1] : 'led-on');
  paintCode();
  updateCursor();
  renderWatch();
  updateFsUi();
  restoreDir();
  var pm = /page=(code|board|scope|notes)/.exec(hash);
  if (pm) setPage(pm[1]);
  var pmatch = /[#&]p=([A-Za-z0-9_-]+)/.exec(hash);
  if (pmatch) {
    try {
      var shared = JSON.parse(b64dec(pmatch[1]));
      if (shared && shared.files && shared.files.length) {
        project = {
          name: shared.name || '分享的工程',
          files: shared.files.filter(function (f) { return f && f.path; })
            .map(function (f) { return { path: f.path, content: String(f.content == null ? '' : f.content) }; }),
          folders: shared.folders || [],
          groups: shared.groups || [],
          open: (shared.open || []).filter(function (x) {
            return shared.files.some(function (f) { return f.path === x; });
          }),
          active: shared.active || shared.files[0].path
        };
        ensureGroups(project);
        if (!project.open.length) project.open = [project.files[0].path];
        if (!fileOf(project.active)) project.active = project.files[0].path;
        codeEl.value = fileOf(project.active).content;
        renderTabs();
        renderTree();
        refreshGutter();
        paintCode();
        build();
        log('已从分享链接还原工程「' + project.name + '」（' + project.files.length + ' 个文件）。', 'ok');
      }
    } catch (e) {
      log('分享链接里的工程解析失败，已退回例程原版。', 'err');
    }
  }
  var cm = /[#&]c=([A-Za-z0-9_-]+)/.exec(hash);
  if (cm) {
    try {
      var f0 = fileOf('main.c') || project.files[0];
      f0.content = b64dec(cm[1]);
      project.active = f0.path;
      codeEl.value = f0.content;
      refreshGutter();
      paintCode();
      build();
      log('已从分享链接还原代码（' + codeEl.value.length + ' 个字符）。', 'ok');
    } catch (e) {
      log('分享链接里的代码解析失败，已退回例程原版。', 'err');
    }
  }
  /* ---------------- 只读分享：链接带 ro=1 时锁编辑，可一键复制成自己的工程 ---------------- */
  if (/[#&]ro=1(?:&|$)/.test(hash)) {
    var roLockIds = ['btn-format', 'btn-restore', 'btn-new-file', 'btn-new-folder', 'btn-import', 'btn-clean', 'proj-import', 'proj-clean'];
    var roSetLock = function (locked) {
      roLockIds.forEach(function (id) {
        var b = $(id);
        if (b) b.disabled = locked;
      });
    };
    codeEl.readOnly = true;
    roSetLock(true);
    var roBar = document.createElement('div');
    roBar.className = 'ro-bar';
    var roText = document.createElement('span');
    roText.textContent = '这是别人分享的只读工程，可以运行、调试、看开发板；想改代码，先复制成自己的工程。';
    var roFork = document.createElement('button');
    roFork.className = 'btn sm';
    roFork.textContent = '复制为自己的工程';
    roFork.onclick = function () {
      codeEl.readOnly = false;
      roSetLock(false);
      roBar.remove();
      project.name += '（副本）';
      saveProject();
      log('已复制为可编辑工程「' + project.name + '」，随便改。', 'ok');
    };
    roBar.appendChild(roText);
    roBar.appendChild(roFork);
    var roWrap = document.querySelector('.editor-wrap');
    if (roWrap && roWrap.parentNode) roWrap.parentNode.insertBefore(roBar, roWrap);
    log('当前是只读分享模式：运行和调试都能用，编辑请先复制为自己的工程。', 'dim');
  }

  var bt = $('build-tag');
  log('已就绪' + (bt ? ' · ' + bt.textContent : ''), 'ok');
  log('F5 运行 · F9 断点 · F11 单步 · Ctrl+F 查找', 'dim');
  log('例程在「讲义」，硬件实验在「开发板」，快捷键看右上角 ?', 'dim');
  requestAnimationFrame(frame);
  /* 支持 #ex=nixie&autorun 这样的链接，打开即运行指定例程 */
  if (/autorun/.test(hash)) startRun();
})();
