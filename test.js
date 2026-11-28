const C51 = require('./src/vm.js');
const HW = require('./src/hw.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function makeVM(code) {
  const hw = HW.createHardware();
  const vm = new C51.VM(code, hw);
  return { vm, hw };
}
function run(vm, frames, time) {
  for (let i = 0; i < frames && !vm.done && !vm.error; i++) vm.pump(3000, time || 16);
}

/* 1. 点亮 LED */
{
  const { vm, hw } = makeVM(`
#include <REGX52.H>
void main(){ P2 = 0xFE; while(1){} }
`);
  run(vm, 5);
  check('LED: P2=0xFE 点亮 P2.0', vm.ports.P2 === 0xFE && hw.leds[0] === 1 && hw.leds[1] === 0,
    'P2=' + vm.ports.P2.toString(16) + ' leds=' + hw.leds.join(''));
  check('无运行错误', !vm.error, vm.error);
}

/* 2. 位运算与位变量 */
{
  const { vm } = makeVM(`
unsigned char g;
void main(){
  unsigned char i;
  g = 0;
  for (i = 0; i < 8; i++) { g = ~(1 << i); P2 = g; }
  P2_0 = 0;
  P2_7 = 0;
  while(1){}
}
`);
  run(vm, 5);
  check('位写 P2_0/P2_7', vm.ports.P2 === 0x7E, 'P2=0x' + vm.ports.P2.toString(16));
}

/* 3. 函数、数组、switch、消抖结构 */
{
  const { vm, hw } = makeVM(`
unsigned char NixieTable[] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};
void Delay(unsigned int xms);
void Nixie(unsigned char Location, unsigned char Number)
{
  switch(Location){
    case 1: P2_4=1; P2_3=1; P2_2=1; break;
    case 2: P2_4=1; P2_3=1; P2_2=0; break;
    case 3: P2_4=1; P2_3=0; P2_2=1; break;
    case 4: P2_4=1; P2_3=0; P2_2=0; break;
    case 5: P2_4=0; P2_3=1; P2_2=1; break;
    case 6: P2_4=0; P2_3=1; P2_2=0; break;
    case 7: P2_4=0; P2_3=0; P2_2=1; break;
    case 8: P2_4=0; P2_3=0; P2_2=0; break;
  }
  P0 = NixieTable[Number];
  Delay(1);
  P0 = 0x00;
}
void main(){ while(1){ Nixie(1,1); Nixie(2,2); Nixie(3,3); Nixie(4,4); } }
`);
  run(vm, 60);
  const got = hw.nixie.slice(0, 4).map(v => v.toString(16));
  check('数码管动态扫描显示 1234',
    hw.nixie[0] === 0x06 && hw.nixie[1] === 0x5B && hw.nixie[2] === 0x4F && hw.nixie[3] === 0x66,
    'nixie=' + got.join(',') + ' err=' + vm.error);
}

/* 4. 按键输入 */
{
  const { vm, hw } = makeVM(`
unsigned char cnt;
void main(){
  cnt = 0;
  while(1){
    if (P3_1 == 0) { Delay(20); while (P3_1 == 0); Delay(20); cnt++; P2 = ~cnt; }
  }
}
`);
  run(vm, 3);
  hw.setKey(vm, 'K1', true);
  run(vm, 6);
  check('按键按下被读到', vm.ports.P3 === 0xFD, 'P3=0x' + vm.ports.P3.toString(16));
  hw.setKey(vm, 'K1', false);
  run(vm, 10);
  check('按键消抖+等松手后计数', vm.globals.cnt === 1 && vm.ports.P2 === 0xFE,
    'cnt=' + vm.globals.cnt + ' P2=0x' + vm.ports.P2.toString(16) + ' err=' + vm.error);
}

/* 4b. 按键抖动开关 */
{
  const hw = HW.createHardware();
  hw.bounce.on = true;
  const vm = new C51.VM('void main(){ while(1){} }', hw);
  vm.vtime = 100;
  hw.setKey(vm, 'K1', true);
  let unstable = false, stableAfter = true;
  for (let i = 0; i < 60; i++) {
    const t = 100 + i * 0.4;
    const v = hw.readPort('P3', vm.ports.P3, t);
    if ((v >> 1) & 1) unstable = true;
  }
  /* 窗口结束后（>20ms）必须是稳定低电平，抖动不能漏到后面 */
  for (let t = 122; t < 140; t += 0.5) {
    if ((hw.readPort('P3', vm.ports.P3, t) >> 1) & 1) stableAfter = false;
  }
  check('抖动：窗口内 P3.1 出现跳变', unstable);
  check('抖动：窗口结束后电平稳定', stableAfter);
  hw.bounce.on = false;
  hw.setKey(vm, 'K1', false);
  hw.setKey(vm, 'K1', true);
  check('抖动关闭：按下立即稳定读到 0', ((hw.readPort('P3', vm.ports.P3, 200) >> 1) & 1) === 0);
}

/* 5. LCD1602 */
{
  const { vm, hw } = makeVM(`
sbit LCD_RS = P2^6;
sbit LCD_RW = P2^5;
sbit LCD_EN = P2^7;
#define LCD_DataPort P0
void LCD_WriteCommand(unsigned char Command){
  LCD_RS=0; LCD_RW=0; LCD_DataPort=Command; LCD_EN=1; LCD_Delay(); LCD_EN=0; LCD_Delay();
}
void LCD_WriteData(unsigned char Data){
  LCD_RS=1; LCD_RW=0; LCD_DataPort=Data; LCD_EN=1; LCD_Delay(); LCD_EN=0; LCD_Delay();
}
void LCD_Init(){
  LCD_WriteCommand(0x38); LCD_WriteCommand(0x0C); LCD_WriteCommand(0x06); LCD_WriteCommand(0x01);
}
void main(){
  LCD_Init();
  LCD_WriteCommand(0x80);
  LCD_WriteData('H'); LCD_WriteData('I');
  LCD_WriteCommand(0x80 | 0x40);
  LCD_WriteData('O'); LCD_WriteData('K');
  while(1){}
}
`);
  run(vm, 10);
  const txt = hw.lcdText();
  check('LCD1602 显示两行', txt[0].startsWith('HI') && txt[1].startsWith('OK'),
    JSON.stringify(txt) + ' err=' + vm.error);
}

/* 6. do-while / 循环移位 / 取模 / 字符串 */
{
  const { vm } = makeVM(`
unsigned char a, b, c;
unsigned char s[4];
void main(){
  unsigned char i, j;
  i = 2; j = 239;
  do { while (--j); } while (--i);
  a = _crol_(0xFE, 1);
  b = _cror_(0xFE, 1);
  c = 23 % 5;
  while(1){}
}
`);
  run(vm, 40);
  check('do-while / _crol_ / _cror_ / %',
    vm.globals.a === 0xFD && vm.globals.b === 0x7F && vm.globals.c === 3,
    'a=' + vm.globals.a.toString(16) + ' b=' + vm.globals.b.toString(16) + ' c=' + vm.globals.c + ' err=' + vm.error);
}

/* 7. 数组参数 + 字符串 + return */
{
  const { vm, hw } = makeVM(`
unsigned char out[8];
unsigned char len(unsigned char s[]){ unsigned char n = 0; while (s[n]) n++; return n; }
void main(){
  unsigned char n;
  n = len("Hello");
  out[0] = n;
  while(1){}
}
`);
  run(vm, 10);
  check('数组参数与字符串长度', vm.globals.out[0] === 5, 'n=' + vm.globals.out[0] + ' err=' + vm.error);
}

/* 8. 数组越界报错 */
{
  const { vm } = makeVM(`
unsigned char t[] = {1,2,3};
void main(){ unsigned char x; x = t[9]; while(1){} }
`);
  run(vm, 5);
  check('数组越界给出中文报错', !!vm.error && /越界/.test(vm.error), vm.error);
}

/* 9. 延时按虚拟时间推进 */
{
  const { vm } = makeVM(`
void main(){ while(1){ P2 = 0xFE; Delay(500); P2 = 0xFF; Delay(500); } }
`);
  run(vm, 3);
  const t1 = vm.vtime;
  run(vm, 40);
  check('Delay 推进虚拟时间', vm.vtime > t1 + 400, 'vtime=' + vm.vtime.toFixed(1));
}

/* 10. 矩阵键盘：行列扫描 */
{
  const { vm, hw } = makeVM(`
unsigned char key(void)
{
  unsigned char n = 0;
  P1 = 0xFF; P1_2 = 0;            //拉低第 2 列
  if (P1_7 == 0) n = 5;
  if (P1_6 == 0) n = 6;
  if (P1_5 == 0) n = 7;
  if (P1_4 == 0) n = 8;
  return n;
}
void main(){ while(1){ P2 = key(); } }
`);
  hw.pressMatrix(2, 1, true);      //第 3 行第 2 列 -> 键码 7
  run(vm, 4);
  check('矩阵键盘：第 2 列第 3 行读到 7', vm.ports.P2 === 7,
    'P2=' + vm.ports.P2 + ' err=' + vm.error);
  hw.pressMatrix(2, 1, false);
  run(vm, 4);
  check('矩阵键盘：松手后读不到键', vm.ports.P2 === 0, 'P2=' + vm.ports.P2);
}

/* 11. 定时器 0 中断：1ms 累加成秒 */
{
  const { vm, hw } = makeVM(`
unsigned char Sec = 0;
void Timer0_Init(void)
{
  TMOD &= 0xF0; TMOD |= 0x01;
  TL0 = 0x18; TH0 = 0xFC;
  TF0 = 0; TR0 = 1; ET0 = 1; EA = 1;
}
void T0_ISR() interrupt 1
{
  static unsigned int c;
  TL0 = 0x18; TH0 = 0xFC; c++;
  if (c >= 1000) { c = 0; Sec++; }
}
void main(){ Timer0_Init(); while(1){} }
`);
  for (let i = 0; i < 120 && !vm.error; i++) vm.pump(4000, 20);
  check('定时器 1ms 中断累计出秒', vm.globals.Sec >= 1,
    'Sec=' + vm.globals.Sec + ' vtime=' + vm.vtime.toFixed(0) + ' err=' + vm.error);
  check('响应中断后 TF0 自动清零', ((vm.sfr.TCON >> 5) & 1) === 0, 'TCON=0x' + vm.sfr.TCON.toString(16));
  check('中断里 static 计数跨调用保留', !!vm.statics['T0_ISR#c'], Object.keys(vm.statics).join(','));
}

/* 11b. IP 位别名：原始江协库 Timer.c / Int0.c 会写 PT0、PX0 */
{
  const { vm } = makeVM(`
void main(){
  IP = 0x00;
  PX0 = 1;
  PX0 = 0;
  PT0 = 1;
  PT1 = 1;
  PS = 1;
  P2 = IP;
  while(1){}
}
`);
  run(vm, 5);
  check('IP 位别名 PT0/PX0/PT1/PS 可用', vm.ports.P2 === 0x1A,
    'P2=0x' + vm.ports.P2.toString(16) + ' err=' + vm.error);
}

/* 12. 串口发送：写 SBUF 立刻完成，TI 自动置位 */
{
  const { vm } = makeVM(`
void send(unsigned char s[])
{
  unsigned char i = 0;
  while (s[i]) { SBUF = s[i]; while (TI == 0); TI = 0; i++; }
}
void main(){ send("Hi\\r\\n"); while(1){} }
`);
  run(vm, 5);
  check('串口发送字符串（含 \\r\\n 转义）', vm.serial === 'Hi\r\n',
    JSON.stringify(vm.serial) + ' err=' + vm.error);
}

/* 13. static 局部变量 */
{
  const { vm } = makeVM(`
unsigned int bump(void){ static unsigned int n; n++; return n; }
void main(){ P2 = bump(); P2 = bump(); P2 = bump(); while(1){} }
`);
  run(vm, 5);
  check('static 局部变量跨调用保留', vm.ports.P2 === 3, 'P2=' + vm.ports.P2 + ' err=' + vm.error);
}

/* 14. 用过 LCD 之后还能扫数码管 */
{
  const hw = HW.createHardware();
  const vm = new C51.VM(`
sbit RS=P2^6; sbit RW=P2^5; sbit EN=P2^7;
void LCD_Delay();
void cmd(unsigned char c){ RS=0; RW=0; P0=c; EN=1; LCD_Delay(); EN=0; LCD_Delay(); }
void main()
{
  cmd(0x38); cmd(0x01);            //先用 1602
  Delay(50);                        //停手 50ms，程序切回数码管
  P2_4=1; P2_3=1; P2_2=1;
  P0 = 0x06;                        //数字 1 的段码
  Delay(2);
  P0 = 0x00;
  while(1){}
}
`, hw);
  run(vm, 20);
  check('用过 LCD 后数码管仍能锁存段码', hw.nixie[0] === 0x06,
    'nixie0=0x' + hw.nixie[0].toString(16) + ' lcdActive=' + hw.lcdActive + ' err=' + vm.error);
}

/* 15. 外部中断 INT0：K3 下降沿触发 */
{
  const { vm } = makeVM(`
unsigned int cnt;
void Int0_Init(void){ IT0 = 1; EX0 = 1; EA = 1; }
void main(){ Int0_Init(); while(1){} }
void Int0_Routine(void) interrupt 0 { cnt++; }
`);
  run(vm, 10);                                     /* 稳定停在主循环 */
  check('未按 K3 时中断计数为 0', cnt0() === 0, 'cnt=' + cnt0());
  function cnt0() { return vm.globals.cnt | 0; }
  vm.setInputBit('P3', 2, 0);                      /* 按下 K3：P3.2 拉低 */
  run(vm, 10);
  check('K3 按下触发 INT0（下降沿）', cnt0() === 1, 'cnt=' + cnt0());
  run(vm, 10);
  check('按住不重复触发（边沿模式）', cnt0() === 1, 'cnt=' + cnt0());
  vm.setInputBit('P3', 2, 1);                      /* 松开 */
  run(vm, 5);
  vm.setInputBit('P3', 2, 0);                      /* 再按一次 */
  run(vm, 10);
  check('第二次按下再触发一次', cnt0() === 2, 'cnt=' + cnt0());
}

/* 16. 外部中断 INT1 低电平触发：按住反复进中断 */
{
  const { vm } = makeVM(`
unsigned int cnt;
void main(){ IT1 = 0; EX1 = 1; EA = 1; while(1){} }
void Int1_Routine(void) interrupt 2 { cnt++; }
`);
  run(vm, 10);
  vm.setInputBit('P3', 3, 0);                      /* 按住 K4：P3.3 低电平 */
  run(vm, 20);
  const c1 = vm.globals.cnt | 0;
  vm.setInputBit('P3', 3, 1);                      /* 松开 */
  run(vm, 20);
  const c2 = vm.globals.cnt | 0;
  check('INT1 低电平按住反复触发', c1 >= 2, 'cnt=' + c1);
  check('INT1 松开后停止触发', c2 === c1, 'c1=' + c1 + ' c2=' + c2);
}

/* 17. 串口接收：轮询式 echo */
{
  const { vm } = makeVM(`
void main()
{
  unsigned char c;
  SCON = 0x50;                        //模式 1，REN=1
  while(1)
  {
    if (RI) { c = SBUF; RI = 0; SBUF = c; while(TI==0); TI = 0; }
  }
}
`);
  run(vm, 20);
  vm.receive(65);                                  /* 发 'A' 给板子 */
  run(vm, 30);
  check('收到字节置 RI、程序读到 SBUF 并回显', vm.serial === 'A',
    'serial=' + JSON.stringify(vm.serial) + ' RI=' + (vm.sfr.SCON & 1));
}

/* 18. 串口接收中断（interrupt 4） */
{
  const { vm } = makeVM(`
unsigned int cnt;
void main(){ SCON = 0x50; ES = 1; EA = 1; while(1){} }
void Uart_Routine(void) interrupt 4
{
  unsigned char c;
  if (RI) { c = SBUF; RI = 0; cnt = cnt + c; }
}
`);
  run(vm, 20);
  vm.receive(65); vm.receive(66);                  /* 'A' + 'B' */
  run(vm, 40);
  check('interrupt 4 收到两字节并累加', (vm.globals.cnt | 0) === 131,
    'cnt=' + (vm.globals.cnt | 0));
  check('RI 最终已清零', (vm.sfr.SCON & 1) === 0, 'SCON=' + vm.sfr.SCON);
}

/* ---------------- 多文件工程：逐文件编译 + 链接 ---------------- */
function makeProjVM(files) {
  const unit = C51.compileProject(files);
  if (unit.errors.length) {
    throw new Error(unit.errors.map(e => e.file + '(' + e.line + '): ' + e.msg).join(' | '));
  }
  const hw = HW.createHardware();
  return { vm: new C51.VM('', hw, unit.ast), hw, unit };
}

/* 19. 跨文件调用：声明在 .h，实现在另一个 .c */
{
  const { vm, hw } = makeProjVM([
    { path: 'main.c', content: '#include <REGX52.H>\n#include "led.h"\nvoid main(){ LED_On(); while(1){} }\n' },
    { path: 'led.h', content: '#ifndef LED_H\n#define LED_H\nvoid LED_On(void);\n#endif\n' },
    { path: 'led.c', content: '#include <REGX52.H>\n#include "led.h"\nvoid LED_On(void){ P2 = 0xFE; }\n' }
  ]);
  run(vm, 6);
  check('多文件：main.c 调用 led.c 里的 LED_On()', vm.ports.P2 === 0xFE && hw.leds[0] === 1,
    'P2=0x' + vm.ports.P2.toString(16));
  check('多文件：无运行错误', !vm.error, vm.error);
}

/* 20. 不同 .c 里的同名 static 函数互不冲突 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: '#include <REGX52.H>\nint useA();\nint useB();\nvoid main(){ if (useA() == 1 && useB() == 2) P2 = 0x0F; while(1){} }\n' },
    { path: 'a.c', content: 'static int helper(){ return 1; }\nint useA(){ return helper(); }\n' },
    { path: 'b.c', content: 'static int helper(){ return 2; }\nint useB(){ return helper(); }\n' }
  ]);
  run(vm, 8);
  check('static：两个文件里的同名 helper 各自生效', vm.ports.P2 === 0x0F,
    'P2=0x' + vm.ports.P2.toString(16));
}

/* 21. 同名非 static 函数 → 重复定义 */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: '#include <REGX52.H>\nvoid dup(){}\nvoid main(){ while(1){} }\n' },
    { path: 'b.c', content: 'void dup(){}\n' }
  ]);
  const msg = unit.errors.map(e => e.msg).join(' | ');
  check('链接：重复定义被拦下', unit.errors.length === 1 && /重复定义/.test(msg), msg);
  check('链接：错误里指出两处文件', /main\.c/.test(msg) && /b\.c/.test(msg), msg);
}

/* 22. 调用没有定义的函数 → 硬错误（对齐 Keil 链接失败） */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: '#include <REGX52.H>\nvoid Missing(void);\nvoid main(){ Missing(); while(1){} }\n' }
  ]);
  check('链接：未定义引用算错误', unit.errors.length === 1 && /Missing/.test(unit.errors[0].msg),
    JSON.stringify(unit.errors));
  check('链接：未定义引用不让构建通过', unit.warnings.length === 0,
    JSON.stringify(unit.warnings));
}

/* 23. 同一头文件被重复 include 只展开一次 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: '#include <REGX52.H>\n#include "f.h"\n#include "f.h"\n#include "f.h"\nvoid main(){ P2 = f(); while(1){} }\n' },
    { path: 'f.h', content: '#ifndef F_H\n#define F_H\nunsigned char f(void);\n#endif\n' },
    { path: 'f.c', content: 'unsigned char f(void){ return 0x7E; }\n' }
  ]);
  run(vm, 6);
  check('include：重复包含只展开一次', vm.ports.P2 === 0x7E,
    'P2=0x' + vm.ports.P2.toString(16));
}

/* 24. 语法错误定位到正确的文件和行 */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: '#include <REGX52.H>\nvoid main(){ while(1){} }\n' },
    { path: 'bad.c', content: '#include <REGX52.H>\nvoid f(){ P2 = ; }\n' }
  ]);
  check('报错：定位到 bad.c', unit.errors.length > 0 && unit.errors[0].file === 'bad.c',
    JSON.stringify(unit.errors));
  check('报错：行号映射到原文件', unit.errors.length > 0 && unit.errors[0].line === 2,
    JSON.stringify(unit.errors));
}

/* 25. 函数头可以打断点：进入函数时停在这一行 */
{
  const { vm } = makeVM(`
#include <REGX52.H>

void main()
{
  P2 = 0xFE;
  while(1){}
}
`);
  let stoppedAt = 0;
  for (let i = 0; i < 30 && !vm.done && !vm.error; i++) {
    const r = vm.pump(1, 16, v => v.line === 4);   /* 模板字符串首行是空行，void main() 在第 4 行 */
    if (r.stopped) { stoppedAt = vm.line; break; }
  }
  check('断点：能打在 void main() 这一行', stoppedAt === 4, 'stoppedAt=' + stoppedAt);
}

/* 26. sbit 写在头文件里，被多个 .c 包含 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: '#include <REGX52.H>\n#include "led.h"\nvoid main(){ LED = 0; while(1){} }\n' },
    { path: 'led.h', content: '#ifndef LED_H\n#define LED_H\nsbit LED = P2^0;\nvoid other(void);\n#endif\n' },
    { path: 'led.c', content: '#include <REGX52.H>\n#include "led.h"\nvoid other(void){ LED = 1; }\n' }
  ]);
  run(vm, 8);
  check('sbit：头文件被多个 .c 包含不报重复', true, '');
  check('sbit：两个文件共用同一个位', vm.ports.P2 === 0xFE, 'P2=0x' + vm.ports.P2.toString(16));
}

/* 27. sbit 同名但定义不同 → 报冲突 */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: '#include <REGX52.H>\nsbit LED = P2^0;\nvoid main(){ while(1){} }\n' },
    { path: 'b.c', content: '#include <REGX52.H>\nsbit LED = P2^1;\n' }
  ]);
  check('sbit：同名不同引脚报冲突',
    unit.errors.some(e => /不一致/.test(e.msg)), JSON.stringify(unit.errors));
}

/* 28. extern 变量：一边声明一边定义 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: 'extern unsigned char flag;\nvoid main(){ flag = 5; P2 = flag; while(1){} }\n' },
    { path: 'g.c', content: 'unsigned char flag;\n' }
  ]);
  run(vm, 8);
  check('extern：不再误报重复定义', !vm.error, vm.error);
  check('extern：读写的是同一个变量', vm.ports.P2 === 5, 'P2=' + vm.ports.P2);
}

/* 29. extern 只有声明没有定义 → 报错 */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: 'extern unsigned char ghost;\nvoid main(){ ghost = 1; while(1){} }\n' }
  ]);
  check('extern：缺定义能报出来', unit.errors.some(e => /没有它的定义/.test(e.msg)),
    JSON.stringify(unit.errors));
}

/* 30. 函数式宏 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: '#define MAX(a,b) ((a)>(b)?(a):(b))\nvoid main(){ P2 = MAX(1,2); while(1){} }\n' }
  ]);
  run(vm, 8);
  check('宏：函数式宏能展开', vm.ports.P2 === 2, 'P2=' + vm.ports.P2);
  check('宏：不再误报未定义函数', !vm.error, vm.error);
}

/* 31. 条件编译 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: '#define USE_LED\nvoid main(){\n#ifdef USE_LED\n P2 = 0xFE;\n#else\n P2 = 0xFF;\n#endif\n while(1){}\n}\n' }
  ]);
  run(vm, 8);
  check('#ifdef：走命中分支', vm.ports.P2 === 0xFE, 'P2=0x' + vm.ports.P2.toString(16));

  const u2 = C51.compileProject([
    { path: 'main.c', content: 'void main(){\n#if 0\n P2 = 0x11;\n#endif\n P2 = 0x22;\n while(1){}\n}\n' }
  ]);
  const hw2 = HW.createHardware();
  const vm2 = new C51.VM('', hw2, u2.ast);
  run(vm2, 8);
  check('#if 0：被屏蔽的分支不执行', vm2.ports.P2 === 0x22, 'P2=0x' + vm2.ports.P2.toString(16));

  const u3 = C51.compileProject([
    { path: 'main.c', content: 'void main(){\n#if (1 + 2 * 3 == 7) && (0x10 >> 4 == 1)\n P2 = 0x33;\n#else\n P2 = 0x44;\n#endif\n while(1){}\n}\n' }
  ]);
  const hw3 = HW.createHardware();
  const vm3 = new C51.VM('', hw3, u3.ast);
  run(vm3, 8);
  check('#if：算术 / 位运算 / 逻辑组合', vm3.ports.P2 === 0x33, 'P2=0x' + vm3.ports.P2.toString(16));

  const u4 = C51.compileProject([
    { path: 'main.c', content: 'void main(){\n#if 0 ? 1 : 0\n P2 = 0x55;\n#else\n P2 = 0x66;\n#endif\n while(1){}\n}\n' }
  ]);
  const hw4 = HW.createHardware();
  const vm4 = new C51.VM('', hw4, u4.ast);
  run(vm4, 8);
  check('#if：三目条件表达式', vm4.ports.P2 === 0x66, 'P2=0x' + vm4.ports.P2.toString(16));

  const u5 = C51.compileProject([
    { path: 'main.c', content: 'void main(){\n#if 0\n P2 = 0x11;\n#elif 1\n P2 = 0x77;\n#else\n P2 = 0x88;\n#endif\n while(1){}\n}\n' }
  ]);
  const hw5 = HW.createHardware();
  const vm5 = new C51.VM('', hw5, u5.ast);
  run(vm5, 8);
  check('#elif：前一分支未命中时命中当前分支', vm5.ports.P2 === 0x77, 'P2=0x' + vm5.ports.P2.toString(16));
}

/* 32. 引号头 / 尖括号自定义头找不到 → 都报错 */
{
  const unit = C51.compileProject([
    { path: 'main.c', content: '#include "nope.h"\nvoid main(){ while(1){} }\n' }
  ]);
  check('include：缺头文件报错', unit.errors.some(e => /找不到头文件/.test(e.msg)),
    JSON.stringify(unit.errors));

  const angle = C51.compileProject([
    { path: 'main.c', content: '#include <foo.h>\nvoid main(){ while(1){} }\n' }
  ]);
  check('include：尖括号自定义头缺失也报错', angle.errors.some(e => /找不到头文件/.test(e.msg)),
    JSON.stringify(angle.errors));
}

/* 33. typedef 基本类型别名 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: 'typedef unsigned char u8;\nu8 g = 5;\nvoid main(){ P2 = g; while(1){} }\n' }
  ]);
  run(vm, 8);
  check('typedef：别名声明与赋值', vm.ports.P2 === 5, 'P2=' + vm.ports.P2);

  const shortUnit = C51.compileProject([
    { path: 'main.c', content: 'typedef unsigned short int u16;\ntypedef signed short int s16;\n'
      + 'u16 a = 0x1234; s16 b = -1;\nvoid main(){ P2 = a; while(1){} }\n' }
  ]);
  check('typedef：unsigned short int / signed short int 能识别',
    shortUnit.errors.length === 0, JSON.stringify(shortUnit.errors));
}

/* 34. struct 成员读写 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: 'struct Point { unsigned char x; unsigned char y; };\n'
      + 'struct Point p;\nvoid main(){ p.x = 3; p.y = 5; P2 = p.x + p.y; while(1){} }\n' }
  ]);
  run(vm, 10);
  check('struct：成员读写', vm.ports.P2 === 8, 'P2=' + vm.ports.P2);
  check('struct：无运行错误', !vm.error, vm.error);
}

/* 35. typedef 匿名结构体 + 结构体数组 + 嵌套 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: 'typedef struct { unsigned char lo; unsigned char hi; } Word;\n'
      + 'typedef struct { Word w; unsigned char n; } Item;\n'
      + 'Item list[3];\n'
      + 'void main(){ list[1].w.hi = 0x12; list[1].n = 1; P2 = list[1].w.hi + list[1].n; while(1){} }\n' }
  ]);
  run(vm, 12);
  check('struct：数组 + 嵌套成员', vm.ports.P2 === 0x13, 'P2=' + vm.ports.P2);
}

/* 36. 成员不存在 / 下标越界要有中文报错 */
{
  const { vm } = makeProjVM([
    { path: 'main.c', content: 'struct A { unsigned char x; };\nstruct A a;\nvoid main(){ a.y = 1; while(1){} }\n' }
  ]);
  run(vm, 6);
  check('struct：成员不存在报错', !!vm.error && /没有成员/.test(vm.error), vm.error);
}

/* 37. 例程：流水灯 + 按住 K1 全亮，松开恢复 */
{
  global.window = {};
  require('./src/examples.js');
  const ex = window.EXAMPLES.find(e => e.id === 'led-flow-key');
  check('例程存在：流水灯 + 按键全亮', !!ex);
  const { vm, hw } = makeVM(ex.code);
  run(vm, 12);
  hw.setKey(vm, 'K1', true);
  run(vm, 20);
  check('按住 K1 八灯全亮', vm.ports.P2 === 0x00, 'P2=0x' + vm.ports.P2.toString(16));
  hw.setKey(vm, 'K1', false);
  run(vm, 24);
  check('松开 K1 恢复流水', vm.ports.P2 !== 0x00, 'P2=0x' + vm.ports.P2.toString(16));
}

/* 38. 引脚板：把多文件工程压平成单个翻译单元 */
{
  const files = [
    { path: 'main.c', content: '#include "led.h"\nvoid main(){ LED_On(); while(1){} }\n' },
    { path: 'led.c', content: '#include "led.h"\nvoid LED_On(){ P2 = 0xFE; }\n' },
    { path: 'led.h', content: '#ifndef LED_H\n#define LED_H\n#include <REGX52.H>\nsbit LED = P2^0;\n'
      + 'void LED_On(void);\n#endif\n' }
  ];
  const flat = C51.flattenProject(files);
  check('引脚板：sbit 只出现一次', (flat.match(/sbit\s+LED/g) || []).length === 1,
    String((flat.match(/sbit\s+LED/g) || []).length));
  check('引脚板：main.c 排在 led.c 之后',
    flat.lastIndexOf('===== main.c') > flat.lastIndexOf('===== led.c'));
  let flatErr = '';
  try { C51.parseUnit(flat); } catch (e) { flatErr = e.message || String(e); }
  check('引脚板：压平后能解析', !flatErr, flatErr);
  const vm = new C51.VM(flat, HW.createHardware());
  run(vm, 8);
  check('引脚板：压平后能跑出结果', vm.ports.P2 === 0xFE, 'P2=0x' + (vm.ports.P2 || 0).toString(16));
}

/* 39. 例程通关条件：不用互动的能达成，需要按键的不会误判 */
{
  const byId = id => window.EXAMPLES.find(e => e.id === id);
  check('通关：每条都有可执行判定',
    window.EXAMPLES.every(e => !e.win || typeof e.win.test === 'function'));

  function tryWin(id, frames) {
    const ex = byId(id), st = {};
    const { vm, hw } = makeVM(ex.code);
    for (let i = 0; i < frames; i++) {
      run(vm, 1);
      let ok = false;
      try { ok = !!ex.win.test(vm, hw, st); } catch (e) { ok = false; }
      if (ok) return true;
    }
    return false;
  }
  [['led-on', 10], ['led-blink', 200], ['led-flow', 200], ['nixie', 30],
    ['lcd', 40], ['buzzer', 200], ['timer-clock', 200], ['uart-hello', 200]]
    .forEach(([id, n]) => check('通关可达：' + byId(id).title, tryWin(id, n)));

  ['key-led', 'key-count', 'led-flow-key', 'combo', 'matrix-key', 'ext-int', 'uart-echo']
    .forEach(id => check('通关不误判：' + byId(id).title, !tryWin(id, 120)));
}

/* 40. 江协库兼容：浮点常量、强制转换、Px.y 点号、整数除法不被带偏 */
{
  const { vm } = makeVM(`
#include <REGX52.H>
float f;
int n;
void main()
{
  f = 30 / 16.0;            /* 浮点除法：1.875，不能截成 1 */
  n = (int)3.9;             /* 强制转换：3 */
  P2 = (unsigned char)(f * 10);   /* 18.75 -> 0x12 */
  P3.0 = 0;                 /* 点号位名，等价 P3_0 */
  while (1) {}
}
`);
  run(vm, 6);
  check('浮点常量：30 / 16.0 = 1.875', Math.abs(vm.getVar('f') - 1.875) < 1e-9, String(vm.getVar('f')));
  check('强制转换：(int)3.9 = 3', vm.getVar('n') === 3, String(vm.getVar('n')));
  check('浮点结果转 unsigned char', vm.ports.P2 === 0x12, 'P2=0x' + vm.ports.P2.toString(16));
  check('P3.0 点号等价 P3_0', (vm.ports.P3 & 1) === 0, 'P3=0x' + vm.ports.P3.toString(16));

  const plain = makeVM(`
#include <REGX52.H>
float f;
void main(){ int a = 7, b = 2; f = a / b; P2 = (unsigned char)(f * 10); P2 = 100 / 3; while(1){} }
`);
  run(plain.vm, 6);
  check('整数除法仍然是整除', plain.vm.ports.P2 === 33, 'P2=' + plain.vm.ports.P2);

  const paren = makeVM(`
#include <REGX52.H>
void main(){ P2 = (3 + 4) * 2; while(1){} }
`);
  run(paren.vm, 4);
  check('普通括号表达式没被当成转换', paren.vm.ports.P2 === 14, 'P2=' + paren.vm.ports.P2);
}

/* 41. 江协 DS18B20 的浮点写法：Temp/16.0 不再报「0」前面不是结构体变量 */
{
  const { vm } = makeVM(`
#include <REGX52.H>
float T;
int Temp = 424;             /* 26.5 x 16 */
void main()
{
  T = Temp / 16.0;
  P2 = (unsigned int)(T * 10);   /* 265，低 8 位 0x09 */
  while (1) {}
}
`);
  run(vm, 6);
  check('DS18B20：Temp/16.0 算出 26.5', Math.abs(vm.getVar('T') - 26.5) < 1e-9, String(vm.getVar('T')));
  check('DS18B20：转成 265 后低 8 位', (vm.ports.P2 & 0xFF) === (265 & 0xFF), 'P2=' + vm.ports.P2);
}

/* 42. DS1302 模型：三线移位读秒、写秒 */
{
  const rdWr = `
#include <REGX52.H>
sbit SCLK = P3^6;
sbit IO = P3^4;
sbit CE = P3^5;
unsigned char rd(unsigned char cmd)
{
  unsigned char i, d = 0;
  cmd |= 0x01;
  CE = 1;
  for (i = 0; i < 8; i++) { IO = cmd & (0x01 << i); SCLK = 0; SCLK = 1; }
  for (i = 0; i < 8; i++) { SCLK = 1; SCLK = 0; if (IO) d |= (0x01 << i); }
  CE = 0; IO = 0;
  return d;
}
void wr(unsigned char cmd, unsigned char d)
{
  unsigned char i;
  CE = 1;
  for (i = 0; i < 8; i++) { IO = cmd & (0x01 << i); SCLK = 1; SCLK = 0; }
  for (i = 0; i < 8; i++) { IO = d & (0x01 << i); SCLK = 1; SCLK = 0; }
  CE = 0;
}
void main()
{
  wr(0x8E, 0x00);          /* 解除写保护 */
  P2 = rd(0x81);           /* 读秒 */
  wr(0x80, 0x30);          /* 写秒 = 30 */
  P2 = rd(0x81);
  while (1) {}
}
`;
  const { vm, hw } = makeVM(rdWr);
  hw.setRtc({ year: 26, month: 11, date: 28, hour: 12, minute: 34, second: 56, day: 5 });
  run(vm, 10);
  check('DS1302：写秒后读回 0x30', vm.ports.P2 === 0x30, 'P2=0x' + vm.ports.P2.toString(16));
  check('DS1302：走时芯片同步到 30 秒', hw.ds1302Now(vm).second === 30,
    JSON.stringify(hw.ds1302Now(vm)));
}

/* 43. XPT2046 模型：命令字 + 16 位读取，按滑块返回 */
{
  const adCode = `
#include <REGX52.H>
sbit DIN = P3^4;
sbit CS = P3^5;
sbit DCLK = P3^6;
sbit DOUT = P3^7;
unsigned int ad(unsigned char cmd)
{
  unsigned char i;
  unsigned int d = 0;
  DCLK = 0; CS = 0;
  for (i = 0; i < 8; i++) { DIN = cmd & (0x80 >> i); DCLK = 1; DCLK = 0; }
  for (i = 0; i < 16; i++) { DCLK = 1; DCLK = 0; if (DOUT) d |= (0x8000 >> i); }
  CS = 1;
  return d >> 8;
}
void main() { P2 = ad(0x94); while (1) {} }
`;
  function adAt(pot) {
    const { vm, hw } = makeVM(adCode);
    hw.setXpt({ pot: pot });
    run(vm, 8);
    return vm.ports.P2;
  }
  check('XPT2046：电位器 100% 读回 255', adAt(100) === 255, String(adAt(100)));
  check('XPT2046：电位器 0% 读回 0', adAt(0) === 0, String(adAt(0)));
  check('XPT2046：电位器 50% 读到中间值', adAt(50) >= 120 && adAt(50) <= 136, String(adAt(50)));
}

/* 44. DS18B20 单总线：复位应答 + 0xCC/0xBE 读温度 */
{
  const code = `
#include <REGX52.H>
sbit DQ = P3^7;
unsigned char owInit(void)
{
  unsigned char i, a;
  DQ = 1; DQ = 0;
  i = 247; while (--i);
  DQ = 1;
  i = 32; while (--i);
  a = DQ;
  i = 247; while (--i);
  return a;
}
void owSend(unsigned char b)
{
  unsigned char i, k;
  for (i = 0; i < 8; i++)
  {
    DQ = 0; k = 4; while (--k);
    DQ = b & (0x01 << i);
    k = 24; while (--k);
    DQ = 1;
  }
}
unsigned char owRecv(void)
{
  unsigned char i, k, b = 0;
  for (i = 0; i < 8; i++)
  {
    DQ = 0; k = 2; while (--k);
    DQ = 1; k = 2; while (--k);
    if (DQ) b |= (0x01 << i);
    k = 24; while (--k);
  }
  return b;
}
float g;
unsigned char ack;
void main()
{
  unsigned char l, h;
  int t;
  ack = owInit();                  /* 有应答 -> 0 */
  owInit();
  owSend(0xCC);
  owSend(0xBE);
  l = owRecv();
  h = owRecv();
  t = (h << 8) | l;
  g = t / 16.0;
  P2 = (unsigned int)(g * 10);
  while (1) {}
}
`;
  const { vm, hw } = makeVM(code);
  hw.setTemp(26.5);
  run(vm, 20);
  check('DS18B20：复位有应答', vm.getVar('ack') === 0, 'ack=' + vm.getVar('ack'));
  check('DS18B20：读回 26.5 度', Math.abs(vm.getVar('g') - 26.5) < 1e-9, String(vm.getVar('g')));
  check('DS18B20：265 的低 8 位', vm.ports.P2 === (265 & 0xFF), 'P2=' + vm.ports.P2);
}

/* 45. 8×8 点阵 + 74HC595：先移位再锁存，P0 选行 */
{
  const code = `
#include <REGX52.H>
sbit SER = P3^4;
sbit RCLK = P3^5;
sbit SRCLK = P3^6;
void send(unsigned char b)
{
  unsigned char i;
  for (i = 0; i < 8; i++) { SER = b & (0x80 >> i); SRCLK = 1; SRCLK = 0; }
  RCLK = 1; RCLK = 0;
}
void main()
{
  RCLK = 0; SRCLK = 0;        /* 上电先拉低，第一次锁存才有上升沿 */
  send(0xA5); P0 = 0x7F;      /* 第 1 行 */
  send(0x3C); P0 = 0xBF;      /* 第 2 行 */
  while (1) {}
}
`;
  const { vm, hw } = makeVM(code);
  run(vm, 10);
  check('点阵：第 1 行列数据 0xA5', hw.dot8.fb[0] === 0xA5, '0x' + hw.dot8.fb[0].toString(16));
  check('点阵：第 2 行列数据 0x3C', hw.dot8.fb[1] === 0x3C, '0x' + hw.dot8.fb[1].toString(16));
}

/* 46. LM358：P2.1 的 PWM 占空比换算成平均电压 */
{
  const code = `
#include <REGX52.H>
sbit DA = P2^1;
void main(){ while (1) { DA = 1; Delay(1); DA = 0; Delay(1); } }
`;
  const { vm, hw } = makeVM(code);
  run(vm, 30);
  check('LM358：1ms 高 / 1ms 低 ≈ 50%', hw.dac.duty > 0.35 && hw.dac.duty < 0.65,
    (hw.dac.duty * 100).toFixed(1) + '%');
  check('LM358：平均电压 ≈ 2.5V', hw.dac.vout > 1.7 && hw.dac.vout < 3.3,
    hw.dac.vout.toFixed(2) + 'V');
}

/* 47. 红外 NEC：帧结构 + P3.2 电平随时间变化 */
{
  const hw = HW.createHardware();
  const fake = {
    stepCount: 0, vtime: 0, p3: 1,
    setInputBit: function (port, bit, v) {
      if (port === 'P3' && bit === 2) this.p3 = v;
    }
  };
  hw.irSend(0x45, fake);
  const lv0 = fake.p3;
  fake.vtime = 5; hw.service(fake);
  const lv5 = fake.p3;
  fake.vtime = 10; hw.service(fake);
  const lv10 = fake.p3;
  fake.vtime = 14; hw.service(fake);
  const lv14 = fake.p3;
  check('红外：NEC 帧有 68 段', hw.ir.frame.length === 68, String(hw.ir.frame.length));
  check('红外：引导码 9ms 低', lv0 === 0 && lv5 === 0, lv0 + '/' + lv5);
  check('红外：引导码 4.5ms 高', lv10 === 1, String(lv10));
  check('红外：第一位数据拉低', lv14 === 0, String(lv14));
}

/* 48. #if 里用宏的数值做比较 */
{
  const { vm } = makeVM(`
#define VER 3
#if VER >= 2
unsigned char a = 2;
#else
unsigned char a = 1;
#endif
#define ENABLE 0
#if ENABLE
unsigned char b = 1;
#else
unsigned char b = 0;
#endif
void main(){ P2 = a; P2 = b; while(1){} }
`);
  run(vm, 3);
  check('#if 宏数值：VER>=2 成立', vm.getVar('a') === 2, 'a=' + vm.getVar('a'));
  check('#if 宏数值：ENABLE 为 0 走 #else', vm.getVar('b') === 0, 'b=' + vm.getVar('b'));
}

/* 49. 有符号 int：C51 的 int 是 16 位补码 */
{
  const { vm } = makeVM(`
int t;
int n = 0xFFF6;
int minus(int v){ return v - 20; }
void main(){
  t = minus(10);
  P2 = (unsigned char)t;
  while(1){}
}
`);
  run(vm, 3);
  check('int：10-20 得 -10', vm.getVar('t') === -10, String(vm.getVar('t')));
  check('int：0xFFF6 按补码是 -10', vm.getVar('n') === -10, String(vm.getVar('n')));
  check('int：-10 赋给 P2 是 0xF6', vm.ports.P2 === 0xF6, '0x' + vm.ports.P2.toString(16));
}

/* 50. 定时器模式 0：13 位（TH 8 位 + TL 低 5 位） */
{
  const { vm } = makeVM(`
#include <REGX52.H>
void main(){
  TMOD = 0x00;              /* T0 模式 0 */
  TH0 = 0x1F; TL0 = 0x1F;   /* 13 位初值 1023，再数 7169 个机器周期溢出 */
  TR0 = 1;
  while (TF0 == 0) {}
  P2 = 0x00;
  while (1) {}
}
`);
  run(vm, 2);
  check('定时器模式 0：13 位能溢出', vm.ports.P2 === 0x00, 'P2=0x' + vm.ports.P2.toString(16));
  check('定时器模式 0：TF0 置位', (vm.sfr.TCON & 0x20) !== 0, 'TCON=0x' + vm.sfr.TCON.toString(16));
}

/* 51. 指针：& 取地址、* 解引用、指针传参、下标与自增 */
{
  const { vm } = makeVM(`
unsigned char a[5] = {1, 2, 3, 4, 5};
unsigned char *p;
unsigned char sum;
void addone(unsigned char *q){ *q = *q + 1; }
void main(){
  unsigned char i;
  sum = 0;
  p = a;
  for (i = 0; i < 5; i++) {
    sum += *p;
    if (i < 4) p++;
  }
  addone(&sum);
  addone(&a[0]);
  p = &a[1];
  *p = 0xAA;
  P2 = sum;
  while (1) {}
}
`);
  run(vm, 5);
  check('指针：遍历数组求和 + 传参自增 = 16', vm.getVar('sum') === 16, String(vm.getVar('sum')));
  check('指针：*p = 0xAA 写回 a[1]', vm.getVar('a')[1] === 0xAA, '0x' + vm.getVar('a')[1].toString(16));
  check('指针：a[0] 经 &a[0] 传参加 1', vm.getVar('a')[0] === 2, String(vm.getVar('a')[0]));
}

/* 52. DS18B20 负温：真实库写法 Temp/16.0，-10℃ */
{
  const code = `
#include <REGX52.H>
sbit DQ = P3^7;
unsigned char owInit(void)
{
  unsigned char i, a;
  DQ = 1; DQ = 0;
  i = 247; while (--i);
  DQ = 1;
  i = 32; while (--i);
  a = DQ;
  i = 247; while (--i);
  return a;
}
void owSend(unsigned char b)
{
  unsigned char i, k;
  for (i = 0; i < 8; i++)
  {
    DQ = 0; k = 4; while (--k);
    DQ = b & (0x01 << i);
    k = 24; while (--k);
    DQ = 1;
  }
}
unsigned char owRecv(void)
{
  unsigned char i, k, b = 0;
  for (i = 0; i < 8; i++)
  {
    DQ = 0; k = 2; while (--k);
    DQ = 1; k = 2; while (--k);
    if (DQ) b |= (0x01 << i);
    k = 24; while (--k);
  }
  return b;
}
float g;
unsigned char ack;
void main()
{
  unsigned char l, h;
  int t;
  ack = owInit();
  owInit();
  owSend(0xCC);
  owSend(0xBE);
  l = owRecv();
  h = owRecv();
  t = (h << 8) | l;
  g = t / 16.0;
  P2 = (unsigned int)(g * 10);
  while (1) {}
}
`;
  const { vm, hw } = makeVM(code);
  hw.setTemp(-10);
  run(vm, 20);
  check('DS18B20：-10℃ 读出负数', Math.abs(vm.getVar('g') + 10) < 1e-9, String(vm.getVar('g')));
  check('DS18B20：负温乘 10 后低 8 位', vm.ports.P2 === ((65436) & 0xFF), 'P2=' + vm.ports.P2);
}

/* 53. 红外 NEC：轮询 P3.2 + 定时器读时间，解出 0x45 */
{
  const code = `
#include <REGX52.H>
sbit IR = P3^2;
unsigned char d[4];
unsigned char ok;
unsigned int now(void){ return ((unsigned int)TH0 << 8) | TL0; }
void main()
{
  unsigned char i, b = 0;
  unsigned int t0, t1, t2, w;
  TMOD = 0x01; TH0 = 0; TL0 = 0; TR0 = 1;
  ok = 1;
  while (IR == 1);                 /* 等引导码低电平 */
  t0 = now();
  while (IR == 0);
  t1 = now();
  while (IR == 1);                 /* 4.5ms 高结束 */
  t2 = now();
  w = t1 - t0;
  if (w < 8000 || w > 10000) ok = 0;
  w = t2 - t1;
  if (w < 4000 || w > 5000) ok = 0;
  for (i = 0; i < 32; i++) {
    while (IR == 0);
    t1 = now();
    while (IR == 1);
    t2 = now();
    if ((t2 - t1) > 1000) b |= (1 << (i & 7));
    if ((i & 7) == 7) { d[i >> 3] = b; b = 0; }
  }
  P2 = d[2];
  while (1) {}
}
`;
  const { vm, hw } = makeVM(code);
  hw.irSend(0x45, vm);
  run(vm, 40);
  check('红外解码：引导码与 4.5ms 高都正确', vm.getVar('ok') === 1, 'ok=' + vm.getVar('ok'));
  check('红外解码：32 位数据还原出 0x45', vm.getVar('d')[2] === 0x45,
    'd2=0x' + vm.getVar('d')[2].toString(16));
  check('红外解码：P2 显示键值', vm.ports.P2 === 0x45, 'P2=0x' + vm.ports.P2.toString(16));
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
