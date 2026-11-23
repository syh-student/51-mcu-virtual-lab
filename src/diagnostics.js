/* ============================================================
 * 诊断建议与静态提醒（独立于内核，方便维护规则）
 * 参考 Clang / Elm 的做法：先说人话，再给一条可操作的修改建议。
 * 全局函数，app.js 直接调用；Node 下也可 require 后使用。
 * ============================================================ */
(function (root) {
  'use strict';

  var BUILTIN_NAMES = ['P0', 'P1', 'P2', 'P3', 'TMOD', 'TCON', 'TH0', 'TL0', 'TH1', 'TL1',
    'SCON', 'SBUF', 'IE', 'IP', 'PCON', 'PSW', 'ACC', 'B', 'TR0', 'TR1', 'TF0', 'TF1',
    'EA', 'ES', 'ET0', 'ET1', 'EX0', 'EX1', 'IT0', 'IT1', 'IE0', 'IE1',
    'main', 'Delay', '_nop_', '_crol_', '_cror_'];

  function editDistance(a, b) {
    var m = a.length, n = b.length;
    if (!m || !n || Math.abs(m - n) > 2) return 99;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function didYouMean(name) {
    var best = '', bestD = 3;
    for (var i = 0; i < BUILTIN_NAMES.length; i++) {
      var d = editDistance(name, BUILTIN_NAMES[i]);
      if (d < bestD) { bestD = d; best = BUILTIN_NAMES[i]; }
    }
    return best && bestD <= 2 ? best : '';
  }

  /* 给一条报错配一句"怎么改"的建议，没有合适建议时返回空串 */
  function diagnose(msg) {
    var m = String(msg || ''), mm;
    mm = /变量 “([^”]+)” 没有定义/.exec(m);
    if (mm) {
      var near = didYouMean(mm[1]);
      var base = '先检查拼写和大小写；自己用的变量要先声明（如 int i;），再使用。';
      if (/^P[0-3][0-7]$/.test(mm[1])) {
        return base + ' 位名要带下划线，例如 ' + mm[1][0] + mm[1][1] + '_' + mm[1][2] + '。';
      }
      if (near) return base + ' 你是不是想写 ' + near + '？';
      return base + ' 内置寄存器有 TMOD / TCON / TH0 / TL0 / SCON / SBUF / IE / PSW，位名形如 P2_0。';
    }
    if (/这里应该是/.test(m)) return '多半是上一行末尾少了分号，或者括号、花括号没有配对——从报错行的上一行开始检查。';
    if (/缺少右花括号/.test(m)) return '有 { 没有配对的 }，从最近的一个函数开始数一遍大括号。';
    if (/数组越界/.test(m)) return '下标从 0 开始，最大只能到「长度 - 1」；循环条件建议写成 i < 长度，不要写成 i <= 长度。';
    if (/没有找到 main 函数/.test(m)) return '补一个入口函数：void main(void) { while (1) { ... } }。';
    mm = /函数 “([^”]+)” 没有定义/.exec(m);
    if (mm) return '先定义再调用，注意大小写；虚拟机内置函数只有 Delay、_nop_、_crol_、_cror_，其它函数要自己写。';
    if (/除以 0|对 0 取余/.test(m)) return '除数可能为 0，先加 if (除数 != 0) 再做除法。';
    if (/调用层次过深|递归没有出口/.test(m)) return '检查递归的结束条件：每一层递归都要让条件更接近出口。';
    if (/暂不支持指针/.test(m)) return '把指针写法改成数组下标，例如 a[i] = 值;';
    if (/sbit 请写成/.test(m)) return '位声明的标准写法：sbit LED = P2^0;（这里用 ^，使用时写 LED = 1;）。';
    if (/do 后面要跟 while/.test(m)) return 'do…while 的完整结构是 do { ... } while (条件);，结尾别漏分号。';
    if (/无法识别的字符/.test(m)) return '检查是不是用了中文标点（；、（）、“”），代码里要用英文符号。';
    if (/数字格式有误/.test(m)) return '十六进制要以 0x 开头（如 0xFC），十进制直接写数字。';
    if (/结果不能被赋值/.test(m)) return '等号左边必须是一个可以写的变量或位，不能是表达式或常量。';
    if (/只有数组才能用下标/.test(m)) return '这个名字不是数组，去掉下标，或先把它声明成数组。';
    if (/前面不是结构体变量|结构体里没有成员/.test(m)) return '检查结构体变量名和成员名是否写错，成员要用 struct 里声明过的名字。';
    return '';
  }

  /* 运行前静态提醒：只报"几乎一定是坑"的写法，避免误报 */
  function lintTips(text) {
    var tips = [];
    var clean = String(text || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
    if (/void\s+main\s*\(/.test(clean)) {
      var body = clean.slice(clean.indexOf('main'));
      if (!/\b(while|for)\b/.test(body)) {
        tips.push('main 里没有主循环：程序会很快跑完，开发板程序一般需要 while (1) { ... } 把逻辑包住。');
      }
    }
    if (/\binterrupt\s+[13]\b/.test(clean) && !/\bEA\s*=/.test(clean)) {
      tips.push('写了定时器中断函数，但没看到 EA = 1：总中断没开，中断函数永远不会执行。');
    }
    if (/\bTR[01]\s*=\s*1/.test(clean) && !/\bTMOD\b/.test(clean)) {
      tips.push('启动了定时器（TR0 / TR1 = 1）但没配置 TMOD：先选工作方式，例如 TMOD = 0x01;（16 位定时）。');
    }
    if (/while\s*\(\s*1\s*\)\s*;/.test(clean)) {
      tips.push('while (1); 是原地死等，程序会一直停在这一行，后面的代码不会执行。');
    }
    if (/\bP[0-3][0-7]\s*=/.test(clean)) {
      tips.push('位名要写带下划线的形式，例如 P2_0 = 1;（P2^0 只用在 sbit 声明里）。');
    }
    return tips;
  }

  var api = { diagnose: diagnose, lintTips: lintTips, didYouMean: didYouMean, editDistance: editDistance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.diagnose = diagnose; root.lintTips = lintTips; }
})(typeof window !== 'undefined' ? window : globalThis);
