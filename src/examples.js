/* 例程：按知识点独立实现，引脚分配与写法遵循通用 51 教学惯例。 */
window.EXAMPLES = [
  {
    id: 'led-on',
    title: '点亮第一个 LED',
    chapter: '端口输出与低电平点亮',
    goal: '运行后，开发板上 D1（P2.0）保持点亮，其余 7 个熄灭。',
    points: [
      '8 个 LED 接在 P2 口，写 0 输出低电平，LED 点亮；写 1 熄灭。',
      '0xFE 的二进制是 1111 1110，只有最低位是 0，所以只亮 D1。',
      '低电平点亮是因为 8051 的灌电流能力强于拉电流能力。',
      'while(1){} 让程序停在这里：没有它，main 执行完程序就结束了。'
    ],
    quiz: ['把 0xFE 改成多少，才能让 D1 和 D2 同时亮？', '如果想点亮 D8（P2.7），应该写多少？'],
    code: `#include <REGX52.H>

void main()
{
	P2 = 0xFE;		//1111 1110，最低位为 0，点亮 D1
	while(1)
	{
	}
}
`
  },
  {
    id: 'led-blink',
    title: 'LED 闪烁与软件延时',
    chapter: '闪烁与软件延时',
    goal: 'D1 以大约 1 秒为周期闪烁（亮 500 ms、灭 500 ms）。',
    points: [
      '闪烁 = 亮—等—灭—等 的循环，Delay 负责"等"。',
      '讲义里的 Delay 靠双层空循环耗时，12 MHz 下约 1 ms 一轮。',
      '虚拟机对 Delay 做了加速：直接推进虚拟时间，不用真的跑几十万次空循环。',
      '软件延时不精确，实际项目里会改用定时器。'
    ],
    quiz: ['把两个 Delay(500) 改成 Delay(100)，观察闪烁频率有什么变化。', '为什么 Delay 的精度会受晶振和编译优化影响？'],
    code: `#include <REGX52.H>

void Delay(unsigned int xms)		//12MHz 下约 xms 毫秒
{
	unsigned char i, j;
	while(xms--)
	{
		i = 2;
		j = 239;
		do
		{
			while (--j);
		} while (--i);
	}
}

void main()
{
	while(1)
	{
		P2 = 0xFE;		//点亮 D1
		Delay(500);
		P2 = 0xFF;		//全灭
		Delay(500);
	}
}
`
  },
  {
    id: 'led-flow',
    title: '流水灯',
    chapter: '流水灯',
    goal: '亮点从 D1 依次移动到 D8，循环往复。',
    points: [
      '流水灯的本质：让"为 0 的那一位"在 8 位里循环移动。',
      '_crol_ 是循环左移，移出去的位会回到另一端；普通 << 会把位移丢。',
      '每次直接给 P2 赋值会覆盖全部 8 位，这也是讲义提醒的常见坑。'
    ],
    quiz: ['把 _crol_ 换成 _cror_，亮点会向哪个方向移动？', '把 LED 的初值改成 0xFC，会看到几个亮点？'],
    code: `#include <REGX52.H>
#include <INTRINS.H>

void Delay(unsigned int xms);	//声明即可：虚拟机内置了 Delay

void main()
{
	unsigned char LED = 0xFE;
	while(1)
	{
		P2 = LED;
		Delay(200);
		LED = _crol_(LED, 1);	//循环左移一位
	}
}
`
  },
  {
    id: 'key-led',
    title: '独立按键控制 LED',
    chapter: '独立按键与消抖',
    goal: '点住开发板上的 K1~K4，对应的 LED 亮起；松手后保持最后按下的那一路。',
    points: [
      'K1~K4 分别接 P3.1、P3.0、P3.2、P3.3，按下为低电平。',
      '消抖 = 读到低电平后 Delay(20) 再确认一次。',
      'while (P3_1 == 0); 是"等待松手"，没有它按住不放会反复触发。',
      '这是阻塞式写法：等松手时其他事情都做不了。'
    ],
    quiz: ['把 while (P3_1 == 0); 删掉，再按住 K1 试试，会发生什么？', 'if (P3_1 = 0) 和 if (P3_1 == 0) 差别在哪？'],
    code: `#include <REGX52.H>

void Delay(unsigned int xms);

unsigned char Key(void)
{
	unsigned char KeyNumber = 0;

	if (P3_1 == 0) { Delay(20); while (P3_1 == 0); Delay(20); KeyNumber = 1; }
	if (P3_0 == 0) { Delay(20); while (P3_0 == 0); Delay(20); KeyNumber = 2; }
	if (P3_2 == 0) { Delay(20); while (P3_2 == 0); Delay(20); KeyNumber = 3; }
	if (P3_3 == 0) { Delay(20); while (P3_3 == 0); Delay(20); KeyNumber = 4; }

	return KeyNumber;
}

void main()
{
	unsigned char KeyNum;
	while(1)
	{
		KeyNum = Key();
		if (KeyNum)
		{
			P2 = ~(1 << (KeyNum - 1));	//按 K1 亮 D1，依此类推
		}
	}
}
`
  },
  {
    id: 'key-count',
    title: '按键计数，二进制显示',
    chapter: '按键计数与二进制显示',
    goal: '每按一次 K1，计数加一，8 个 LED 用二进制显示这个数。',
    points: [
      '把 P2 当成一个 8 位显示器：P2 = ~Count，用 LED 直接看二进制。',
      '~ 是按位取反，因为 LED 低电平点亮，所以要反过来。',
      '计数到 255 再加一会回到 0，这就是 8 位变量的溢出。'
    ],
    quiz: ['连按 5 次 K1，LED 应该亮哪几个？对照二进制验算一下。', '把 P2 = ~Count 改成 P2 = Count，显示规律变成什么样？'],
    code: `#include <REGX52.H>

void Delay(unsigned int xms);

void main()
{
	unsigned char Count = 0;
	P2 = ~Count;
	while(1)
	{
		if (P3_1 == 0)			//K1 按下
		{
			Delay(20);			//消抖
			while (P3_1 == 0);	//等待松手
			Delay(20);
			Count++;
			P2 = ~Count;		//低电平点亮，所以取反
		}
	}
}
`
  },
  {
    id: 'nixie',
    title: '数码管动态扫描显示 1234',
    chapter: '数码管位选、段选与消影',
    goal: '8 位数码管的前 4 位稳定显示 1 2 3 4，不闪烁、不重影。',
    points: [
      '共阴数码管：段码高电平点亮，数字 1 的段码是 0x06。',
      '8 位共用 P0 做段选，位选由 P2.4/P2.3/P2.2 经 74HC138 译码。',
      '每次只亮一位，靠快速轮流 + 视觉暂留形成"同时亮"。',
      'P0 = 0x00 是消影：切换位之前先清段码，否则会有重影。',
      '把 Delay(1) 改成 Delay(50) 试试：刷新太慢就会明显闪烁。'
    ],
    quiz: ['推导数字 3 和字母 C 的共阴段码，再改段码表验证。', '把 P0 = 0x00 这行删掉，观察是否出现重影。'],
    code: `#include <REGX52.H>

unsigned char NixieTable[] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};

void Delay(unsigned int xms);

void Nixie(unsigned char Location, unsigned char Number)
{
	switch (Location)				//位选：经 74HC138 译码
	{
		case 1: P2_4=1; P2_3=1; P2_2=1; break;
		case 2: P2_4=1; P2_3=1; P2_2=0; break;
		case 3: P2_4=1; P2_3=0; P2_2=1; break;
		case 4: P2_4=1; P2_3=0; P2_2=0; break;
		case 5: P2_4=0; P2_3=1; P2_2=1; break;
		case 6: P2_4=0; P2_3=1; P2_2=0; break;
		case 7: P2_4=0; P2_3=0; P2_2=1; break;
		case 8: P2_4=0; P2_3=0; P2_2=0; break;
	}
	P0 = NixieTable[Number];		//段选输出
	Delay(1);						//显示 1ms
	P0 = 0x00;						//消影
}

void main()
{
	while(1)
	{
		Nixie(1, 1);
		Nixie(2, 2);
		Nixie(3, 3);
		Nixie(4, 4);
	}
}
`
  },
  {
    id: 'lcd',
    title: 'LCD1602 显示两行文字',
    chapter: 'LCD1602 初始化与写操作',
    goal: '液晶屏第一行显示 Hello 51!，第二行显示 STC89C52RC。',
    points: [
      'RS=P2.6 选数据/指令，RW=P2.5 选读/写，E=P2.7 下降沿执行。',
      'P0 是 8 位数据总线；第二行地址要加 0x40。',
      '初始化顺序 0x38 → 0x0C → 0x06 → 0x01，不能乱。',
      '讲义用指针写字符串，这里改成等价的数组下标写法（虚拟机暂不支持指针）。'
    ],
    quiz: ['要在第 2 行第 5 列显示字符 A，调用链怎么写？', '把 LCD_ShowString(2,1,...) 的第 2 个参数改成 1，看看两行会不会重叠。'],
    code: `#include <REGX52.H>

sbit LCD_RS = P2^6;
sbit LCD_RW = P2^5;
sbit LCD_EN = P2^7;
#define LCD_DataPort P0

void LCD_Delay();		//虚拟机内置；真实板子上用一小段空循环

void LCD_WriteCommand(unsigned char Command)
{
	LCD_RS = 0;  LCD_RW = 0;
	LCD_DataPort = Command;
	LCD_EN = 1;  LCD_Delay();
	LCD_EN = 0;  LCD_Delay();
}

void LCD_WriteData(unsigned char Data)
{
	LCD_RS = 1;  LCD_RW = 0;
	LCD_DataPort = Data;
	LCD_EN = 1;  LCD_Delay();
	LCD_EN = 0;  LCD_Delay();
}

void LCD_Init(void)
{
	LCD_WriteCommand(0x38);	//八位数据接口，两行，5*7 点阵
	LCD_WriteCommand(0x0C);	//显示开，光标关
	LCD_WriteCommand(0x06);	//写入后地址自动加一
	LCD_WriteCommand(0x01);	//清屏
}

void LCD_SetCursor(unsigned char Line, unsigned char Column)
{
	if (Line == 1) LCD_WriteCommand(0x80 | (Column - 1));
	else LCD_WriteCommand(0x80 | (Column - 1 + 0x40));
}

void LCD_ShowString(unsigned char Line, unsigned char Column, unsigned char String[])
{
	unsigned char i = 0;
	LCD_SetCursor(Line, Column);
	while (String[i] != 0)
	{
		LCD_WriteData(String[i]);
		i++;
	}
}

void main()
{
	LCD_Init();
	LCD_ShowString(1, 1, "Hello 51!");
	LCD_ShowString(2, 1, "STC89C52RC");
	while(1)
	{
	}
}
`
  },
  {
    id: 'buzzer',
    title: '蜂鸣器提示音',
    chapter: '蜂鸣器提示音',
    goal: '蜂鸣器图标周期性闪动，表示正在以约 1 kHz 翻转；可打开声音听到"嘀"声。',
    points: [
      '开发板蜂鸣器接 P1.5，是无源蜂鸣器：必须给方波才响。',
      '每 500 μs 翻转一次，周期 1 ms，对应约 1 kHz。',
      'Buzzer = !Buzzer 是翻转电平最常用的写法。',
      'I/O 驱动能力不够，真实板子上要经过三极管或 ULN2003。'
    ],
    quiz: ['想发出 440 Hz 的标准音 A，半周期延时应该是多少？', '把翻转次数从 200 改成 600，听感上有什么变化？'],
    code: `#include <REGX52.H>

sbit Buzzer = P1^5;

void Delay(unsigned int xms);
void Delay500us();		//虚拟机内置，推进 0.5 ms 虚拟时间

void main()
{
	unsigned int i;
	while(1)
	{
		for (i = 0; i < 200; i++)	//每 500us 翻转一次，约 1kHz
		{
			Buzzer = !Buzzer;
			Delay500us();
		}
		Delay(300);
	}
}
`
  },
  {
    id: 'combo',
    title: '综合：按键计数器（数码管显示）',
    chapter: '按键与显示组合',
    goal: '数码管显示 0000，每按一次 K1 数字加一；按住不放时观察显示的变化。',
    points: [
      '主循环一边扫描数码管，一边检测按键，这是"多任务"的雏形。',
      '按住 K1 时程序停在"等待松手"，扫描被拖慢，显示会变暗甚至只剩一位。',
      '这正是讲义说的：时钟项目里必须改成定时器扫描的非阻塞写法。',
      '取每一位数字用 / 和 %：num/1000%10 是千位，依此类推。'
    ],
    quiz: ['为什么按住 K1 时显示会变暗？用"扫描被阻塞"来解释。', '如果要让计数在按键时也不影响显示，可以怎么改？（提示：用定时器扫描）'],
    code: `#include <REGX52.H>

unsigned char NixieTable[] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F};

void Delay(unsigned int xms);

void Nixie(unsigned char Location, unsigned char Number)
{
	switch (Location)
	{
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

void main()
{
	unsigned int Count = 0;
	while(1)
	{
		if (P3_1 == 0)
		{
			Delay(20);
			while (P3_1 == 0);
			Delay(20);
			Count++;
		}
		Nixie(1, Count / 1000 % 10);
		Nixie(2, Count / 100 % 10);
		Nixie(3, Count / 10 % 10);
		Nixie(4, Count % 10);
	}
}
`
  },
  {
    id: 'matrix-key',
    title: '矩阵键盘读键码',
    chapter: '矩阵键盘与行列扫描',
    goal: '按住开发板上 4×4 键盘里的任意一个键，1602 第一行显示它的键码（1~16）。',
    points: [
      '16 个键只占 8 根线：4 行接 P1.7~P1.4，4 列接 P1.3~P1.0。',
      '扫描原理：把某一列拉低，再逐个读 4 行；哪一行为 0，就说明"这一行 + 这一列"的键被按下。',
      '所以按下的那一刻必须先 P1 = 0xFF 把列全部放开，再单独拉低一列，否则会和上一列串在一起。',
      '键码 = 列号 × 4 + 行号 + 1，这正是讲义 MatrixKey() 的编号方式；板子上每个键印的数字就是它的键码。',
      'while (P1_7 == 0); 是在等松手，没有它按一次会连续触发很多次。'
    ],
    quiz: [
      '如果同时按住两个键（比如插在第 1 列第 1 行和第 2 列第 2 行），MatrixKey() 会返回哪个？为什么？',
      '把 P1 = 0xFF; 这一句删掉，观察扫描结果会怎么乱。'
    ],
    code: `#include <REGX52.H>

sbit LCD_RS = P2^6;
sbit LCD_RW = P2^5;
sbit LCD_EN = P2^7;
#define LCD_DataPort P0

void Delay(unsigned int xms);
void LCD_Delay();		//虚拟机内置；真板子上是一小段空循环

void LCD_WriteCommand(unsigned char Command)
{
	LCD_RS = 0;  LCD_RW = 0;
	LCD_DataPort = Command;
	LCD_EN = 1;  LCD_Delay();
	LCD_EN = 0;  LCD_Delay();
}

void LCD_WriteData(unsigned char Data)
{
	LCD_RS = 1;  LCD_RW = 0;
	LCD_DataPort = Data;
	LCD_EN = 1;  LCD_Delay();
	LCD_EN = 0;  LCD_Delay();
}

void LCD_Init(void)
{
	LCD_WriteCommand(0x38);
	LCD_WriteCommand(0x0C);
	LCD_WriteCommand(0x06);
	LCD_WriteCommand(0x01);
}

void LCD_SetCursor(unsigned char Line, unsigned char Column)
{
	if (Line == 1) LCD_WriteCommand(0x80 | (Column - 1));
	else LCD_WriteCommand(0x80 | (Column - 1 + 0x40));
}

void LCD_ShowNum(unsigned char Line, unsigned char Column, unsigned int Number, unsigned char Length)
{
	unsigned char i;
	unsigned int Div = 1;
	LCD_SetCursor(Line, Column);
	for (i = 1; i < Length; i++) Div *= 10;		//1 -> 10 -> 100 ...
	for (i = 0; i < Length; i++)
	{
		LCD_WriteData('0' + Number / Div % 10);
		Div /= 10;
	}
}

unsigned char MatrixKey(void)
{
	unsigned char KeyNumber = 0;

	P1 = 0xFF;
	P1_3 = 0;						//第 1 列拉低
	if (P1_7 == 0) { Delay(20); while (P1_7 == 0); Delay(20); KeyNumber = 1; }
	if (P1_6 == 0) { Delay(20); while (P1_6 == 0); Delay(20); KeyNumber = 2; }
	if (P1_5 == 0) { Delay(20); while (P1_5 == 0); Delay(20); KeyNumber = 3; }
	if (P1_4 == 0) { Delay(20); while (P1_4 == 0); Delay(20); KeyNumber = 4; }

	P1 = 0xFF;
	P1_2 = 0;						//第 2 列拉低
	if (P1_7 == 0) { Delay(20); while (P1_7 == 0); Delay(20); KeyNumber = 5; }
	if (P1_6 == 0) { Delay(20); while (P1_6 == 0); Delay(20); KeyNumber = 6; }
	if (P1_5 == 0) { Delay(20); while (P1_5 == 0); Delay(20); KeyNumber = 7; }
	if (P1_4 == 0) { Delay(20); while (P1_4 == 0); Delay(20); KeyNumber = 8; }

	P1 = 0xFF;
	P1_1 = 0;						//第 3 列拉低
	if (P1_7 == 0) { Delay(20); while (P1_7 == 0); Delay(20); KeyNumber = 9; }
	if (P1_6 == 0) { Delay(20); while (P1_6 == 0); Delay(20); KeyNumber = 10; }
	if (P1_5 == 0) { Delay(20); while (P1_5 == 0); Delay(20); KeyNumber = 11; }
	if (P1_4 == 0) { Delay(20); while (P1_4 == 0); Delay(20); KeyNumber = 12; }

	P1 = 0xFF;
	P1_0 = 0;						//第 4 列拉低
	if (P1_7 == 0) { Delay(20); while (P1_7 == 0); Delay(20); KeyNumber = 13; }
	if (P1_6 == 0) { Delay(20); while (P1_6 == 0); Delay(20); KeyNumber = 14; }
	if (P1_5 == 0) { Delay(20); while (P1_5 == 0); Delay(20); KeyNumber = 15; }
	if (P1_4 == 0) { Delay(20); while (P1_4 == 0); Delay(20); KeyNumber = 16; }

	return KeyNumber;
}

void main()
{
	unsigned char KeyNum;
	LCD_Init();
	LCD_SetCursor(1, 1);
	LCD_WriteData('K');  LCD_WriteData('E');  LCD_WriteData('Y');
	LCD_ShowNum(2, 1, 0, 2);
	while (1)
	{
		KeyNum = MatrixKey();
		if (KeyNum)
		{
			LCD_ShowNum(2, 1, KeyNum, 2);
		}
	}
}
`
  },
  {
    id: 'timer-clock',
    title: '定时器中断做秒表',
    chapter: '定时器与中断（1ms 中断）',
    goal: '数码管显示 分-秒，从 00-00 开始每秒加一，到 00-59 进位。',
    points: [
      'TMOD 低 4 位选定时器 0；0x01 = 16 位定时，不自装载。',
      '12 MHz 下一个机器周期 1 μs，定 1 ms 就是数 1000 个数：初值 = 65536 - 1000 = 0xFC18。',
      'TR0 启动计数，ET0 允许定时器 0 中断，EA 打开总中断——三个开关缺一不可。',
      '溢出后硬件不会自动装回初值，所以中断函数里必须重新写 TL0 / TH0，否则下一次间隔就不对了。',
      'static unsigned int T0Count; 只在第一次执行时清零，之后一直累加；换成普通局部变量会被反复清零。',
      '主循环只管扫描数码管，计数交给中断，这就是定时器相比 Delay 的价值：两件事互不干扰。'
    ],
    quiz: [
      '把初值改成 0xD8F0（10 ms），如果要 1 秒，T0Count 应该数到多少？',
      '把 ET0 = 1; 删掉会发生什么？再试把 EA = 1; 删掉。',
      '为什么中断函数里的 T0Count 必须是 static？'
    ],
    code: `#include <REGX52.H>

unsigned char NixieTable[] = {0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F,0x40,0x00};
unsigned char Min = 0;
unsigned char Sec = 0;

void Delay(unsigned int xms);

void Nixie(unsigned char Location, unsigned char Number)
{
	switch (Location)
	{
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
	P0 = 0x00;						//消影
}

void Timer0_Init(void)
{
	TMOD &= 0xF0;					//只改低 4 位，别碰定时器 1
	TMOD |= 0x01;					//定时器 0，模式 1：16 位
	TL0 = 0x18;						//1ms 初值 0xFC18
	TH0 = 0xFC;
	TF0 = 0;						//先清掉可能残留的溢出标志
	TR0 = 1;						//开始计数
	ET0 = 1;						//允许定时器 0 中断
	EA = 1;							//打开总中断
}

void Timer0_Routine() interrupt 1
{
	static unsigned int T0Count;
	TL0 = 0x18;						//重装初值
	TH0 = 0xFC;
	T0Count++;
	if (T0Count >= 1000)			//1000 个 1ms = 1 秒
	{
		T0Count = 0;
		Sec++;
		if (Sec >= 60)
		{
			Sec = 0;
			Min++;
			if (Min >= 60) Min = 0;
		}
	}
}

void main()
{
	Timer0_Init();
	while (1)
	{
		Nixie(1, Min / 10 % 10);
		Nixie(2, Min % 10);
		Nixie(3, 10);				//段码表第 10 项是中间的横杠
		Nixie(4, Sec / 10 % 10);
		Nixie(5, Sec % 10);
	}
}
`
  },
  {
    id: 'uart-hello',
    title: '串口发送 Hello',
    chapter: '串口发送与 printf 调试',
    goal: '每秒钟往串口发两行文字；切到左下角「串口」标签就能看到输出。',
    points: [
      'SBUF 是发送/接收共用的一个字节寄存器，写进去就启动一次发送。',
      'while (TI == 0); 在等"发送完成"；发完硬件把 TI 置 1，要由软件清零。',
      'SCON = 0x40 选模式 1（8 位数据）；TH1 / TL1 决定波特率，讲义用 4800 bps。',
      '仿真里没有真实波特率延迟：写 SBUF 立刻置 TI，所以这段循环不会卡住。',
      '字符串在 C 里是"字符数组 + 结尾的 0"，所以 UART_SendString 用 str[i] != 0 判断结束。',
      '串口最大的用途是调试：程序跑飞时，把关键变量打出来比盯着数码管猜快得多。'
    ],
    quiz: [
      '把 UART_SendByte 里的 TI = 0; 删掉，第二次发送会停在哪里？',
      '想每 100ms 发一次，Delay(1000) 应该改成多少？',
      '为什么 UART_SendString 的参数写成 str[] 而不是 *str？'
    ],
    code: `#include <REGX52.H>

void Delay(unsigned int xms);

void UART_Init(void)
{
	SCON = 0x40;					//串口模式 1：8 位数据，可变波特率
	PCON |= 0x80;					//SMOD = 1，波特率加倍
	TMOD &= 0x0F;					//只改高 4 位
	TMOD |= 0x20;					//定时器 1，模式 2：8 位自动重装（做波特率发生器）
	TH1 = 0xF3;						//4800bps @ 12MHz，SMOD = 1
	TL1 = 0xF3;
	TR1 = 1;
}

void UART_SendByte(unsigned char Byte)
{
	SBUF = Byte;
	while (TI == 0);				//等发送完成
	TI = 0;							//软件清零
}

void UART_SendString(unsigned char str[])
{
	unsigned char i = 0;
	while (str[i] != 0)
	{
		UART_SendByte(str[i]);
		i++;
	}
}

void main()
{
	unsigned char n = 0;
	UART_Init();
	while (1)
	{
		UART_SendString("Hello 51!\\r\\n");
		UART_SendString("frame ");
		UART_SendByte('0' + n % 10);
		UART_SendString("\\r\\n");
		n++;
		Delay(1000);
	}
}
`
  },
  {
    id: 'ext-int',
    title: '外部中断：K3 一按就响应',
    chapter: '外部中断 INT0 / INT1',
    goal: '按下 K3（P3.2）瞬间进中断，8 个 LED 按次数加一；主循环里一行按键代码都没有。',
    points: [
      'INT0 接在 P3.2，板上正好是 K3；按下瞬间电平从高变低，就是一个下降沿。',
      'IT0 = 1 选下降沿触发；IT0 = 0 是低电平触发——按住 K3 不放会反复进中断。',
      'EX0 允许外部中断 0、EA 打开总中断，两个开关缺一不可。',
      '外部中断不用在主循环里轮询按键，这就是"事件驱动"：有事发中断，没事睡觉。',
      '中断函数里的 cnt 必须用 static，普通局部变量每次进中断都会被清零。',
      '仿真里按住 K3（鼠标按住）再松开，就会看到 P2 上的 8 个 LED 加一。'
    ],
    quiz: [
      '把 IT0 改成 0（低电平触发），按住 K3 不放会看到什么现象？',
      '想改成按 K4（P3.3）触发，要动哪几个寄存器和向量号？（IT1、EX1、interrupt 2）',
      '为什么中断函数不需要自己清 IE0？（提示：边沿触发进中断时硬件自动清）'
    ],
    code: `#include <REGX52.H>

void Int0_Init(void)
{
	IT0 = 1;						//INT0 下降沿触发（0 是低电平触发）
	EX0 = 1;						//允许外部中断 0
	EA = 1;							//打开总中断
}

void main()
{
	Int0_Init();
	while (1)
	{
		//主循环什么都不用做——按下 K3 的瞬间，程序会自己跳进中断函数
	}
}

void Int0_Routine(void) interrupt 0
{
	static unsigned int cnt;
	cnt++;
	P2 = ~(cnt & 0xFF);				//低电平点亮：按一次，8 个 LED 当作二进制数加一
}
`
  },
  {
    id: 'uart-echo',
    title: '串口回显（接收 + interrupt 4）',
    chapter: '串口接收与调试',
    goal: '在左下角「串口」标签的输入框打字发送，板子收到什么就原样发回来（回显）。',
    points: [
      'REN = 1 才允许接收；SCON = 0x50 比发送版的 0x40 多的那一位就是 REN。',
      '收到的字节进 SBUF 并把 RI 置 1，RI 必须软件清零——规矩和 TI 完全对称。',
      '发送完成（TI）和接收完成（RI）共用 interrupt 4，进中断要自己判断是谁来的。',
      '回显是验证串口通不通的最小实验：发什么回什么，说明收发链路都活着。',
      '仿真里发送框输入的字节会写进 SBUF 并置 RI；开了 ES + EA 就直接进串口中断。',
      '先读走 SBUF 再清 RI，顺序反了会丢掉刚收到的字节。'
    ],
    quiz: [
      '把 RI = 0; 删掉，再发第二个字节会发生什么？',
      '为什么 UART_Routine 里也要处理 TI？（提示：UART_SendByte 在等谁）',
      '想收到字符 1 就点亮 P2.0，中断函数里应该加哪几行？'
    ],
    code: `#include <REGX52.H>

void UART_Init(void)
{
	SCON = 0x50;					//模式 1，REN = 1 允许接收
	PCON |= 0x80;					//SMOD = 1，波特率加倍
	TMOD &= 0x0F;
	TMOD |= 0x20;					//定时器 1 做波特率发生器
	TH1 = 0xF3;						//4800bps @ 12MHz
	TL1 = 0xF3;
	TR1 = 1;
	ES = 1;							//允许串口中断
	EA = 1;							//打开总中断
}

void main()
{
	UART_Init();
	while (1)
	{
		//收发都在中断里完成，主循环可以腾出来干别的
	}
}

void UART_Routine(void) interrupt 4
{
	unsigned char c;
	if (RI)							//接收完成：SBUF 里有新字节
	{
		c = SBUF;					//先读走
		RI = 0;						//软件清零，准备收下一个
		SBUF = c;					//原样发回去（回显）
		while (TI == 0);
		TI = 0;
	}
}
`
  },
  {
    id: 'blank',
    title: '空白模板（自己写）',
    chapter: '自由练习',
    goal: '在这里写你自己的程序。支持 P0~P3、P2_0 这类位名、sbit、数组、函数、if/while/for/switch。',
    points: [
      '端口：P0~P3 直接当 8 位变量读写，P2_0 这类是位变量。',
      '内置函数：Delay(ms)、Delay500us()、_nop_()、_crol_()、_cror_()。',
      '也支持：矩阵键盘（P1 行列扫描）、定时器 0/1 与中断（interrupt 1/3）、外部中断 INT0/INT1（interrupt 0/2，K3/K4 触发）、串口收发（SBUF）。',
      '暂不支持：指针、结构体、I2C / 单总线时序、ADC。',
      '出错时控制台会给出中文提示和行号。'
    ],
    quiz: [],
    code: `#include <REGX52.H>

void Delay(unsigned int xms);

void main()
{
	while(1)
	{
		//在这里写你的代码

	}
}
`
  }
];
