/* 诊断建议与静态提醒的单元测试：node test-diagnostics.js */
'use strict';
const assert = require('assert');
const d = require('./src/diagnostics.js');

let n = 0;
function ok(cond, name) { assert.ok(cond, name); n++; console.log('  ✓ ' + name); }

console.log('诊断建议');
ok(d.diagnose('变量 “TMO” 没有定义').includes('TMOD'), '未定义变量给 did-you-mean 建议');
ok(d.diagnose('变量 “P20” 没有定义，不能赋值').includes('P2_0'), 'P20 提示写成 P2_0');
ok(d.diagnose('这里应该是 “;”，却读到了 “}”').includes('分号'), '缺少分号给可操作建议');
ok(d.diagnose('数组越界：这个数组只有 10 项（下标 0~9），却用了下标 10').includes('长度 - 1'), '数组越界解释下标范围');
ok(d.diagnose('没有找到 main 函数：程序需要有 void main() { ... } 作为入口').includes('void main'), '缺 main 给入口模板');
ok(d.diagnose('函数 “Delay_ms” 没有定义（虚拟机已内置 Delay、_nop_、_crol_、_cror_）').includes('Delay'), '未定义函数提示内置函数');
ok(d.diagnose('除以 0：请检查除数是否可能为零').includes('除数'), '除零给保护建议');
ok(d.diagnose('虚拟机暂不支持指针运算符 “*”，请改用数组下标写法').includes('数组下标'), '指针建议改数组');
ok(d.diagnose('sbit 请写成 sbit 名字 = P2^0; 这样的形式').includes('P2^0'), 'sbit 给标准写法');
ok(d.diagnose('无法识别的字符 “；”').includes('中文标点'), '中文标点提醒');
ok(d.diagnose('某个完全不认识的内部错误') === '', '不认识的错误不乱给建议');

console.log('编辑距离');
ok(d.editDistance('TMOD', 'TMO') === 1, '编辑距离计算正确');
ok(d.didYouMean('TMO') === 'TMOD', 'TMO 联想到 TMOD');
ok(d.didYouMean('xyzabc') === '', '差太远不乱猜');

console.log('静态提醒');
ok(d.lintTips('void main(void) { P1 = 0; }').some(t => t.includes('主循环')), 'main 没有主循环时提醒');
ok(d.lintTips('void main(void) { while (1) { P1 = 0; } }').length === 0, '正常写法不误报');
ok(d.lintTips('void t0() interrupt 1 { }\nvoid main(void) { while (1) { } }').some(t => t.includes('EA = 1')), '写了中断没开 EA 时提醒');
ok(d.lintTips('void main(void) { TR0 = 1; while (1) { } }').some(t => t.includes('TMOD')), '启动定时器没配 TMOD 时提醒');
ok(d.lintTips('void main(void) { while (1) { } }\nvoid t0() interrupt 1 { }\nvoid init() { EA = 1; TMOD = 0x01; }').length === 0, '开了 EA 配了 TMOD 不提醒');
ok(d.lintTips('void main(void) { P20 = 1; while (1) { } }').some(t => t.includes('P2_0')), 'P20 赋值提醒位名写法');
ok(d.lintTips('// while (1);\nvoid main(void) { while (1) { } }').length === 0, '注释里的写法不触发提醒');

console.log('\n诊断测试通过，共 ' + n + ' 项');
