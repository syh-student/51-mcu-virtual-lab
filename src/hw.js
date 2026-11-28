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

  /* DS1302 的走时状态放在 createHardware 外面：重新编译/复位不该把时钟清零，
     就像板上那颗备用电池还在。 */
  var RTC = {
    base: Date.UTC(2026, 10, 28, 12, 0, 0),
    lastVtime: 0,
    battery: true,
    wp: 0
  };

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

    RTC.lastVtime = 0;      /* 每次构建从 0 开始计虚拟时间，时间基准由“电池”保留 */

    /* ---------------- DS1302 时钟 + XPT2046 模数 ----------------
       两台都是边沿驱动：CE/SCLK 或 CS/DCLK 一变就推进一位，
       不依赖微秒延时，所以不用改虚拟机的时间模型。 */
    hw.ds1302 = { ce: 0, sclk: 0, mode: 'idle', bits: 0, cmd: 0, data: 0, out: 0, outBit: 0 };
    hw.xpt = { pot: 50, ntc: 25, ldr: 500, ext: 2.5 };
    hw.xptBus = { phase: 'idle', bits: 0, cmd: 0, data16: 0, outIdx: 0, skip: 0 };
    hw.ds18b20 = {
      temp: 25, phase: 'idle', bits: 0, byte: 0, queue: [], outBit: 0,
      fallStep: 0, presenceUntil: 0, releaseAt: 0, matchBits: 0,
      rom: [0x28, 0xAA, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]
    };
    /* 8×8 点阵：74HC595 列数据（SER=P3.4 / RCLK=P3.5 / SRCLK=P3.6），P0 行选低有效 */
    hw.dot8 = { ser: 1, shift: 0, latch: 0, seen: -1e9, fb: [0, 0, 0, 0, 0, 0, 0, 0] };
    /* LM358：P2.1 的 PWM 经低通后的平均值（只做测量，不影响程序） */
    hw.dac = { level: 1, riseAt: 0, high: 0, start: 0, duty: 0, vout: 0 };
    /* 红外：虚拟遥控器发的 NEC 帧，按虚拟时间在 P3.2 上输出 */
    hw.ir = { active: false, frame: [], start: 0, idx: 0, total: 0, code: 0 };

    function bcd(n) { return ((n / 10 | 0) << 4) | (n % 10); }
    function unbcd(b) { return (b >> 4) * 10 + (b & 0x0F); }
    function rtcSync(vm) {
      if (!vm) return;
      var dt = vm.vtime - RTC.lastVtime;
      if (dt > 0 && RTC.battery) RTC.base += dt;
      RTC.lastVtime = vm.vtime;
    }
    function rtcFields() {
      var d = new Date(RTC.base);
      var wd = d.getUTCDay();
      return {
        year: d.getUTCFullYear() % 100,
        month: d.getUTCMonth() + 1,
        date: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        day: wd === 0 ? 7 : wd
      };
    }
    function rtcRead(reg, vm) {
      rtcSync(vm);
      var f = rtcFields();
      if (reg === 0) return bcd(f.second) & 0x7F;
      if (reg === 1) return bcd(f.minute);
      if (reg === 2) return bcd(f.hour);
      if (reg === 3) return bcd(f.date);
      if (reg === 4) return bcd(f.month);
      if (reg === 5) return f.day;
      if (reg === 6) return bcd(f.year);
      if (reg === 7) return RTC.wp ? 0x80 : 0x00;
      return 0;
    }
    function rtcWrite(reg, raw, vm) {
      if (reg === 7) { RTC.wp = raw & 0x80; return; }
      if (RTC.wp) return;
      rtcSync(vm);
      var f = rtcFields(), v = unbcd(raw & 0xFF);
      if (reg === 0) f.second = v & 0x7F;
      else if (reg === 1) f.minute = v & 0x7F;
      else if (reg === 2) f.hour = v & 0x3F;
      else if (reg === 3) f.date = v & 0x3F;
      else if (reg === 4) f.month = v & 0x1F;
      else if (reg === 5) f.day = (v & 7) || 1;
      else if (reg === 6) f.year = v & 0xFF;
      RTC.base = Date.UTC(2000 + f.year, f.month - 1, f.date, f.hour, f.minute, f.second);
      RTC.lastVtime = vm ? vm.vtime : RTC.lastVtime;
    }
    function dsEdge(oldV, newV, vm) {
      var ds = hw.ds1302;
      var ceOld = (oldV >> 5) & 1, ce = (newV >> 5) & 1;
      var clkOld = (oldV >> 6) & 1, clk = (newV >> 6) & 1;
      var io = (newV >> 4) & 1;
      if (ce && !ceOld) { ds.ce = 1; ds.mode = 'cmd'; ds.bits = 0; ds.cmd = 0; ds.data = 0; }
      if (!ce && ceOld) {
        ds.ce = 0;
        if (ds.mode === 'write' && ds.bits >= 8) rtcWrite((ds.cmd & 0x1E) >> 1, ds.data, vm);
        ds.mode = 'idle';
      }
      if (!ds.ce) return;
      if (clk && !clkOld) {
        if (ds.mode === 'cmd') {
          ds.cmd |= io << ds.bits;
          ds.bits++;
          if (ds.bits === 8) {
            if (ds.cmd & 1) {
              ds.mode = 'read';
              ds.out = rtcRead((ds.cmd & 0x1E) >> 1, vm);
              ds.outBit = 0;
            } else { ds.mode = 'write'; ds.bits = 0; ds.data = 0; }
          }
        } else if (ds.mode === 'write') {
          ds.data |= io << ds.bits;
          ds.bits++;
        }
      } else if (!clk && clkOld && ds.mode === 'read') {
        var bitv = ds.outBit < 8 ? ((ds.out >> ds.outBit) & 1) : 0;
        ds.outBit++;
        if (vm) vm.setInputBit('P3', 4, bitv);
      }
    }
    function xptValue(cmd) {
      var x = hw.xpt, ch = cmd & 0xF0;
      if (ch === 0x90) return Math.round(x.pot / 100 * 4095);
      if (ch === 0xA0) return Math.round(x.ldr / 1000 * 4095);
      if (ch === 0xD0) return Math.round((80 - x.ntc) / 100 * 4095);
      if (ch === 0xE0) return Math.round(x.ext / 5 * 4095);
      return 0;
    }
    function xptEdge(oldV, newV, vm) {
      var s = hw.xptBus;
      var csOld = (oldV >> 5) & 1, cs = (newV >> 5) & 1;
      var clkOld = (oldV >> 6) & 1, clk = (newV >> 6) & 1;
      var din = (newV >> 4) & 1;
      if (!cs && csOld) { s.phase = 'cmd'; s.bits = 0; s.cmd = 0; s.outIdx = 0; s.skip = 0; }
      if (cs && !csOld) { s.phase = 'idle'; if (vm) vm.setInputBit('P3', 7, 1); }
      if (cs) return;
      if (clk && !clkOld) {
        if (s.phase === 'cmd') {
          s.cmd |= din << (7 - s.bits);
          s.bits++;
          if (s.bits === 8) {
            s.phase = 'data';
            s.data16 = (xptValue(s.cmd) & 0x0FFF) << 4;
            s.outIdx = 0;
            s.skip = 1;       /* 命令字最后那个下降沿是转换间隙，不算数据位 */
          }
        }
      } else if (!clk && clkOld && s.phase === 'data') {
        if (s.skip > 0) { s.skip--; if (vm) vm.setInputBit('P3', 7, 1); return; }
        var bitv = s.outIdx < 16 ? ((s.data16 >> (15 - s.outIdx)) & 1) : 0;
        s.outIdx++;
        if (vm) vm.setInputBit('P3', 7, bitv);
      }
    }

    /* ---------------- DS18B20 单总线 ----------------
       忙等循环不推进虚拟时间，所以用“语句数”近似时序（江协库实测）：
       复位低电平约 249 条、写 1 约 6 条、写 0 约 32 条、读时隙约 4 条。 */
    function ds18NextBit() {
      var d = hw.ds18b20;
      if (!d.queue.length) return 1;
      var b = (d.queue[0] >> d.outBit) & 1;
      d.outBit++;
      if (d.outBit >= 8) { d.queue.shift(); d.outBit = 0; }
      return b;
    }
    function ds18Scratchpad() {
      var t = Math.round((hw.ds18b20.temp || 0) * 16);
      return [t & 0xFF, (t >> 8) & 0xFF, 0x4B, 0x46, 0x7F, 0xFF, 0x0C, 0x10, 0x00];
    }
    function ds18Edge(oldV, newV, vm) {
      var d = hw.ds18b20;
      var a = (oldV >> 7) & 1, b = (newV >> 7) & 1;
      if (a === b) return;
      if (b === 0) { d.fallStep = vm ? vm.stepCount : 0; return; }
      var lowSteps = (vm ? vm.stepCount : 0) - d.fallStep;
      if (d.presenceUntil) return;
      if (lowSteps > 100) {
        /* 复位脉冲：拉低应答；主机约 40 条语句后采样，120 条后释放，赶在命令字节之前 */
        d.phase = 'rom'; d.bits = 0; d.byte = 0; d.queue = []; d.outBit = 0;
        d.presenceUntil = (vm ? vm.stepCount : 0) + 120;
        if (vm) vm.setInputBit('P3', 7, 0);
        return;
      }
      if (d.phase === 'read' || d.phase === 'readrom') {
        var bit = ds18NextBit();
        if (bit === 0) {
          if (vm) vm.setInputBit('P3', 7, 0);
          d.releaseAt = (vm ? vm.stepCount : 0) + 14;
        }
        return;
      }
      if (d.phase === 'match') {
        d.matchBits++;
        if (d.matchBits >= 64) { d.phase = 'func'; d.bits = 0; d.byte = 0; d.matchBits = 0; }
        return;
      }
      if (d.phase !== 'rom' && d.phase !== 'func') return;
      var v = lowSteps < 15 ? 1 : 0;
      d.byte |= v << d.bits;
      d.bits++;
      if (d.bits < 8) return;
      var cmd = d.byte;
      d.byte = 0; d.bits = 0;
      if (d.phase === 'rom') {
        if (cmd === 0xCC) d.phase = 'func';
        else if (cmd === 0x33) { d.phase = 'readrom'; d.queue = d.rom.slice(); d.outBit = 0; }
        else if (cmd === 0x55) { d.phase = 'match'; d.matchBits = 0; }
        else d.phase = 'idle';
      } else {
        if (cmd === 0x44) d.phase = 'convert';
        else if (cmd === 0xBE) { d.phase = 'read'; d.queue = ds18Scratchpad(); d.outBit = 0; }
        else d.phase = 'idle';
      }
    }
    hw.service = function (vm) {
      var d = hw.ds18b20;
      if (d.presenceUntil && vm.stepCount >= d.presenceUntil) {
        d.presenceUntil = 0;
        vm.setInputBit('P3', 7, 1);
      }
      if (d.releaseAt && vm.stepCount >= d.releaseAt) {
        d.releaseAt = 0;
        vm.setInputBit('P3', 7, 1);
      }
      if (hw.ir.active) {
        /* 帧表里的时间是微秒，vtime 是毫秒，先换算再比较 */
        var e = (vm.vtime - hw.ir.start) * 1000;
        if (e >= hw.ir.total) {
          hw.ir.active = false;
          vm.setInputBit('P3', 2, 1);
        } else {
          var seg = hw.ir.frame, k = 0;
          while (k < seg.length - 1 && seg[k + 1].t <= e) k++;
          /* 每拍都把电平写回去：帧开始那一刻 P3.2 可能刚被 syncAll 拉高，
             只按“段变化”写会丢掉引导码的第一个低电平 */
          hw.ir.idx = k;
          vm.setInputBit('P3', 2, seg[k].l);
        }
      }
    };
    hw.setTemp = function (c) {
      hw.ds18b20.temp = Math.max(-55, Math.min(125, +c || 0));
    };

    /* 74HC595：SER 在 SRCLK 上升沿移入，RCLK 上升沿锁存到列输出 */
    function dotEdge(oldV, newV, vm) {
      var d = hw.dot8;
      var ser = (newV >> 4) & 1;
      var srOld = (oldV >> 6) & 1, sr = (newV >> 6) & 1;
      var rcOld = (oldV >> 5) & 1, rc = (newV >> 5) & 1;
      if (ser !== ((oldV >> 4) & 1)) d.ser = ser;
      if (sr && !srOld) { d.shift = ((d.shift << 1) | d.ser) & 0xFF; d.seen = vm ? vm.vtime : 0; }
      if (rc && !rcOld) { d.latch = d.shift; d.seen = vm ? vm.vtime : 0; }
    }
    /* LM358：P2.1 的 PWM 占空比 -> 0~5V，100ms 滚动窗口 */
    function dacEdge(level, vm) {
      var d = hw.dac;
      if (!vm) return;
      var t = vm.vtime;
      if (!d.start) { d.start = t; d.riseAt = t; }
      if (d.level === 1 && level === 0) d.high += Math.max(0, t - d.riseAt);
      if (level === 1) d.riseAt = t;
      d.level = level;
      var total = t - d.start;
      if (total >= 100) {
        d.duty = d.high / total;
        d.vout = d.duty * 5;
        d.high = 0; d.start = t; d.riseAt = level ? t : 0;
      } else if (total > 0) {
        d.duty = (d.high + (level ? t - d.riseAt : 0)) / total;
        d.vout = d.duty * 5;
      }
    }
    /* 红外遥控：NEC 帧（地址 0x00 + 命令），按虚拟时间输出到 P3.2 */
    hw.irSend = function (code, vm) {
      if (!vm) return false;
      var cmd = code & 0xFF;
      var bits = [];
      [0x00, 0xFF, cmd, (~cmd) & 0xFF].forEach(function (b) {
        for (var i = 0; i < 8; i++) bits.push((b >> i) & 1);
      });
      var seg = [{ l: 0, ms: 9000 }, { l: 1, ms: 4500 }];
      bits.forEach(function (bit) {
        seg.push({ l: 0, ms: 560 });
        seg.push({ l: 1, ms: bit ? 1690 : 560 });
      });
      seg.push({ l: 0, ms: 560 });
      seg.push({ l: 1, ms: 120000 });
      var t = 0;
      seg.forEach(function (s) { s.t = t; t += s.ms; });
      hw.ir.frame = seg;
      hw.ir.start = vm.vtime;
      hw.ir.idx = 0;
      hw.ir.total = t;
      hw.ir.code = cmd;
      hw.ir.active = true;
      vm.setInputBit('P3', 2, 0);
      return true;
    };

    hw.onP3 = function (oldV, newV, vm) {
      dsEdge(oldV, newV, vm);
      xptEdge(oldV, newV, vm);
      ds18Edge(oldV, newV, vm);
      dotEdge(oldV, newV, vm);
    };
    hw.setXpt = function (v) {
      if (!v) return;
      if (v.pot != null) hw.xpt.pot = Math.max(0, Math.min(100, +v.pot || 0));
      if (v.ntc != null) hw.xpt.ntc = Math.max(-20, Math.min(80, +v.ntc || 0));
      if (v.ldr != null) hw.xpt.ldr = Math.max(0, Math.min(1000, +v.ldr || 0));
      if (v.ext != null) hw.xpt.ext = Math.max(0, Math.min(5, +v.ext || 0));
    };
    hw.setRtc = function (f, vm) {
      if (!f) return;
      var cur = rtcFields();
      ['year', 'month', 'date', 'hour', 'minute', 'second', 'day'].forEach(function (k) {
        if (f[k] != null) cur[k] = +f[k];
      });
      RTC.base = Date.UTC(2000 + cur.year, cur.month - 1, cur.date, cur.hour, cur.minute, cur.second);
      RTC.wp = 0;             /* 手动设时间时顺手解除写保护 */
      RTC.lastVtime = vm ? vm.vtime : 0;
    };
    hw.setRtcBattery = function (on, vm) {
      rtcSync(vm);
      RTC.battery = !!on;
      RTC.lastVtime = vm ? vm.vtime : RTC.lastVtime;
    };
    hw.ds1302Now = function (vm) { rtcSync(vm); return rtcFields(); };
    hw.tickRtc = function (ms) {
      /* 程序没在跑的时候，时钟按真实时间走（真板上的 RTC 本来就不受 MCU 控制） */
      if (RTC.battery && ms > 0) RTC.base += ms;
    };
    hw.rtcBattery = function () { return RTC.battery; };

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
      hw.ds1302 = { ce: 0, sclk: 0, mode: 'idle', bits: 0, cmd: 0, data: 0, out: 0, outBit: 0 };
      hw.xptBus = { phase: 'idle', bits: 0, cmd: 0, data16: 0, outIdx: 0, skip: 0 };
      hw.ds18b20 = {
        temp: hw.ds18b20.temp, phase: 'idle', bits: 0, byte: 0, queue: [], outBit: 0,
        fallStep: 0, presenceUntil: 0, releaseAt: 0, matchBits: 0,
        rom: [0x28, 0xAA, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]
      };
      hw.dot8 = { ser: 1, shift: 0, latch: 0, seen: -1e9, fb: [0, 0, 0, 0, 0, 0, 0, 0] };
      hw.dac = { level: 1, riseAt: 0, high: 0, start: 0, duty: 0, vout: 0 };
      hw.ir = { active: false, frame: [], start: 0, idx: 0, total: 0, code: 0 };
      /* 时钟走时和 XPT/DS18B20 的设置不清：前者靠备用电池，后两者是用户拧的旋钮 */
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
        var daOld = (oldV >> 1) & 1, daNew = (newV >> 1) & 1;
        if (daOld !== daNew) dacEdge(daNew, vm);
      }
      if (port === 'P1') {
        var bOld = (oldV >> 5) & 1, bNew = (newV >> 5) & 1;
        /* 位写和整口写会先后各来一次，电平没真变就不要再记一遍，否则翻转间隔会被抹成 0 */
        if (bOld !== bNew && hw.buzzer.level !== bNew) {
          hw.buzzer.flips++;
          hw.buzzer.prevFlip = hw.buzzer.lastFlip;
          hw.buzzer.lastFlip = vm ? vm.vtime : 0;
        }
        hw.buzzer.level = bNew;
      }
      if (port === 'P0') {
        /* 最近 20ms 动过 595，就把 P0 当点阵行选（低有效），不再当数码管段码 */
        if (hw.dot8.seen > -1e8 && vm && (vm.vtime - hw.dot8.seen) < 20) {
          for (var db = 0; db < 8; db++) {
            if (((newV >> db) & 1) === 0) hw.dot8.fb[7 - db] = hw.dot8.latch;
          }
          return;
        }
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
      if (port === 'P3') hw.onP3(oldV, newV, vm);
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
