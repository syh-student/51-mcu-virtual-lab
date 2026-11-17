/* ==========================================================================
 * 虚拟开发板硬件模型（纯逻辑，无 DOM）
 * 引脚对应讲义所用开发板：
 *   LED     ：P2.0~P2.7，低电平点亮
 *   独立按键：K1=P3.1  K2=P3.0  K3=P3.2  K4=P3.3，按下为低电平
 *   矩阵键盘：4×4，行 P1.7~P1.4，列 P1.3~P1.0；列拉低时按下的键把对应行也拉低
 *   数码管  ：P0 段选（共阴段码），位选 P2.4/P2.3/P2.2 经 74HC138 译码
 *   LCD1602 ：RS=P2.6  RW=P2.5  E=P2.7（下降沿执行），数据总线 P0
 *   蜂鸣器  ：P1.5，无源，靠电平翻转发声
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.C51HW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_BITS = { K1: 1, K2: 0, K3: 2, K4: 3 };

  function createHardware() {
    var hw = {
      leds: [0, 0, 0, 0, 0, 0, 0, 0],          // 1 = 点亮
      nixie: [0, 0, 0, 0, 0, 0, 0, 0],          // 每位锁存的段码
      nixieTime: new Array(8).fill(-1e9),        // 每位最后一次被点亮的虚拟时间（视觉暂留）
      lcdActive: false,
      lcdSeenAt: -1e9,                           /* 最近一次 LCD 写操作的虚拟时间 */
      lcd: { ddram: new Array(80).fill(32), addr: 0, writes: 0 },
      buzzer: { level: 1, flips: 0, lastFlip: -1e9, prevFlip: -1e9 },
      keys: { K1: 1, K2: 1, K3: 1, K4: 1 },     // 1 = 松开
      matrix: new Array(16).fill(0),             // 4×4 矩阵键盘，1 = 按下
      /* 按键抖动：真实按键在按下/松开的 5~20ms 内电平会来回跳。
         默认关，打开后 readPort 在抖动窗口内返回抖动的值，用来演示消抖的必要性。 */
      bounce: { on: false, win: {} },
      scanCount: 0,
      /* 时序图用的电平记录：{ t: 虚拟毫秒, port, v } —— 只在电平真正变化时入队。
         全程视图要保留整次运行，所以上限给得大；到顶后按时间桶抽稀，不缩短时间范围。 */
      trace: [],
      traceCompacted: false,
      traceLimit: 60000
    };

    /* 密集扫描（例如数码管 1ms 扫 8 位）几秒就能攒几万条。
       按时间桶压缩：同一桶内每个端口只留最后一次变化，整次运行的起止时刻和宏观波形都还在，
       而且每个端口自身的 t 依旧严格递增，绘制时不会左右回跳。 */
    hw.compactTrace = function () {
      var tr = hw.trace;
      if (tr.length < 2) return;
      var total = tr[tr.length - 1].t || 1;
      var bucket = Math.max(total / 3000, 1e-6);
      var out = [], map = {}, cur = -1;
      var ports = ['P0', 'P1', 'P2', 'P3'];
      function flush() {
        for (var j = 0; j < 4; j++) if (map[ports[j]]) out.push(map[ports[j]]);
        map = {};
      }
      for (var i = 0; i < tr.length; i++) {
        var e = tr[i];
        var b = Math.floor(e.t / bucket);
        if (b !== cur) { if (cur >= 0) flush(); cur = b; }
        map[e.port] = e;
      }
      flush();
      hw.trace = out;
      hw.traceCompacted = true;
    };

    hw.pushTrace = function (port, v, t) {
      var tr = hw.trace;
      tr.push({ t: t, port: port, v: v & 0xFF });
      if (tr.length > hw.traceLimit) hw.compactTrace();
    };

    hw.reset = function () {
      hw.leds = [0, 0, 0, 0, 0, 0, 0, 0];
      hw.nixie = [0, 0, 0, 0, 0, 0, 0, 0];
      hw.nixieTime = new Array(8).fill(-1e9);
      hw.lcdActive = false;
      hw.lcdSeenAt = -1e9;
      hw.lcd = { ddram: new Array(80).fill(32), addr: 0, writes: 0 };
      hw.buzzer = { level: 1, flips: 0, lastFlip: -1e9, prevFlip: -1e9 };
      hw.matrix = new Array(16).fill(0);
      hw.bounce.win = {};
      hw.scanCount = 0;
      hw.trace = [];
      hw.traceCompacted = false;
    };

    hw.syncAll = function (vm) {
      hw.updateLeds(vm);
    };

    hw.updateLeds = function (vm) {
      var p2 = vm.ports.P2;
      for (var i = 0; i < 8; i++) hw.leds[i] = ((p2 >> i) & 1) === 0 ? 1 : 0;
    };

    /* 位选译码：P2.4/P2.3/P2.2 -> 74HC138 -> 第几位数码管 */
    hw.decodeLocation = function (vm) {
      var p2 = vm.ports.P2;
      var sel = (((p2 >> 4) & 1) << 2) | (((p2 >> 3) & 1) << 1) | ((p2 >> 2) & 1);
      return 8 - sel;   // 讲义 Nixie() 的 Location：1~8
    };

    hw.onBitWrite = function (port, bit, val, vm) {
      /* 程序一旦操作 LCD 控制线，P0 的写入就视为 LCD 数据，不再当作数码管段码 */
      if (port === 'P2' && (bit >= 5 && bit <= 7)) {
        hw.lcdActive = true;
        hw.lcdSeenAt = vm ? vm.vtime : 0;
      }
      if (port === 'P1' && bit === 5) {
        if (hw.buzzer.level !== val) {
          hw.buzzer.flips++;
          hw.buzzer.prevFlip = hw.buzzer.lastFlip;
          hw.buzzer.lastFlip = vm ? vm.vtime : 0;
        }
        hw.buzzer.level = val;
      }
    };

    hw.onPortWrite = function (port, oldV, newV, vm) {
      /* 电平真的变了才记一次，时序图用 */
      if (oldV !== newV) hw.pushTrace(port, newV, vm ? vm.vtime : 0);
      if (port === 'P2') {
        hw.updateLeds(vm);
        var enOld = (oldV >> 7) & 1, enNew = (newV >> 7) & 1;
        if (enOld === 1 && enNew === 0) hw.lcdLatch(vm);
      }
      if (port === 'P1') {
        var bOld = (oldV >> 5) & 1, bNew = (newV >> 5) & 1;
        if (bOld !== bNew) {
          hw.buzzer.flips++;
          hw.buzzer.prevFlip = hw.buzzer.lastFlip;
          hw.buzzer.lastFlip = vm ? vm.vtime : 0;
        }
        hw.buzzer.level = bNew;
      }
      if (port === 'P0') {
        /* LCD 不会一直占着 P0：20ms 内没有新的 LCD 写操作，就认为程序已经切回数码管扫描。
           以前 lcdActive 一旦置位永不恢复，用过 LCD 的程序再扫数码管会整片不亮。 */
        var fresh = hw.lcdActive && (vm ? (vm.vtime - hw.lcdSeenAt) : 0) < 20;
        if (!fresh) {
          hw.lcdActive = false;
          if (newV !== 0) {
            var loc = hw.decodeLocation(vm);
            if (loc >= 1 && loc <= 8) {
              hw.nixie[loc - 1] = newV & 0xFF;
              hw.nixieTime[loc - 1] = vm.vtime;
              hw.scanCount++;
            }
          }
        }
      }
    };

    /* LCD1602：E 下降沿锁存 */
    hw.lcdLatch = function (vm) {
      var rs = (vm.ports.P2 >> 6) & 1;
      var data = vm.ports.P0 & 0xFF;
      var lcd = hw.lcd;
      hw.lcdSeenAt = vm.vtime;
      lcd.writes++;
      if (rs === 1) {
        if (lcd.addr >= 0 && lcd.addr < 80) lcd.ddram[lcd.addr] = data;
        lcd.addr = lcd.addr === 0x27 ? 0x40 : (lcd.addr + 1) % 80;
      } else {
        if (data === 0x01) { lcd.ddram.fill(32); lcd.addr = 0; }
        else if (data === 0x02) { lcd.addr = 0; }
        else if (data & 0x80) { lcd.addr = data & 0x7F; }
      }
    };

    hw.lcdText = function () {
      function row(base) {
        var s = '';
        for (var i = 0; i < 16; i++) {
          var c = hw.lcd.ddram[base + i];
          s += (c >= 32 && c <= 126) ? String.fromCharCode(c) : ' ';
        }
        return s;
      }
      return [row(0x00), row(0x40)];
    };

    /* 按键输入：只改变 P3 电平，不触发程序写端口的动作 */
    hw.setKey = function (vm, key, pressed) {
      var bit = KEY_BITS[key];
      if (bit === undefined) return;
      hw.keys[key] = pressed ? 0 : 1;
      vm.setInputBit('P3', bit, pressed ? 0 : 1);
      if (hw.bounce.on) {
        var t0 = vm ? vm.vtime : 0;
        hw.bounce.win[key] = {
          from: t0 + Math.random() * 1.5,
          until: t0 + 6 + Math.random() * 14,
          stable: pressed ? 0 : 1,
          salt: Math.random() * 1000
        };
      }
      hw.pushTrace('P3', vm.ports.P3, vm.vtime);
    };

    /* ---------------- 4×4 矩阵键盘 ----------------
       行接 P1.7~P1.4，列接 P1.3~P1.0。程序把某一列拉低后读行：
       该列上有键按下，对应的行也会被拉低，于是 P1_x == 0 成立。
       读操作不改端口本身，只影响"读回来的值"，这样时序图上看到的仍是程序写出去的电平。
       键码与讲义的 MatrixKey() 一致：第 c 列第 r 行 = c*4 + r + 1。
    ------------------------------------------------------------------ */
    hw.readPort = function (port, written, t) {
      /* 抖动窗口内，P3 上的按键位按伪随机序列跳动 */
      if (port === 'P3' && hw.bounce.on) {
        var now = t || 0;
        Object.keys(hw.bounce.win).forEach(function (k) {
          var w = hw.bounce.win[k];
          if (!w || now > w.until) return;
          var kb = KEY_BITS[k];
          var v = w.stable;
          if (now >= w.from) {
            var step = Math.floor((now - w.from) / 0.6);
            var r = Math.abs(Math.sin((step + w.salt) * 12.9898) * 43758.5453) % 1;
            v = r < 0.55 ? w.stable : (w.stable ? 0 : 1);
          }
          written = v ? (written | (1 << kb)) : (written & ~(1 << kb));
        });
      }
      if (port !== 'P1') return written;
      var v = written;
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < 4; c++) {
          if (!hw.matrix[r * 4 + c]) continue;
          if (((written >> (3 - c)) & 1) === 0) v &= ~(1 << (7 - r));
        }
      }
      return v & 0xFF;
    };
    hw.pressMatrix = function (r, c, down) {
      if (r < 0 || r > 3 || c < 0 || c > 3) return;
      hw.matrix[r * 4 + c] = down ? 1 : 0;
    };
    hw.matrixKeyOf = function (r, c) { return c * 4 + r + 1; };

    return hw;
  }

  return { createHardware: createHardware, KEY_BITS: KEY_BITS };
});
