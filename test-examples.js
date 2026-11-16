/* 逐个例程做冒烟测试：能否编译、运行是否报错、外设是否有预期反应 */
global.window = {};
require('./src/examples.js');
const C51 = require('./src/vm.js');
const HW = require('./src/hw.js');

let fail = 0;
for (const ex of window.EXAMPLES) {
  const hw = HW.createHardware();
  let vm;
  try {
    vm = new C51.VM(ex.code, hw);
  } catch (e) {
    console.log('FAIL  ' + ex.title + '  编译: ' + e.toString());
    fail++;
    continue;
  }
  for (let i = 0; i < 40 && !vm.done && !vm.error; i++) vm.pump(3000, 16);
  const brief = {
    P2: '0x' + vm.ports.P2.toString(16),
    leds: hw.leds.join(''),
    nixie: hw.nixie.map(v => v.toString(16)).join(','),
    lcd: hw.lcdText().map(s => s.trim()),
    buzzerFlips: hw.buzzer.flips,
    vtime: Math.round(vm.vtime)
  };
  if (vm.error) { console.log('FAIL  ' + ex.title + '  运行: ' + vm.error); fail++; }
  else console.log('OK    ' + ex.title + '\n      ' + JSON.stringify(brief));
}
console.log(fail ? '\n有 ' + fail + ' 个例程失败' : '\n全部例程可编译运行');
process.exit(fail ? 1 : 0);
