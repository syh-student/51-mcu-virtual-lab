# 参与开发

这是一个个人学习项目，欢迎提 Issue、提 PR、补例程。仓库刻意保持"零运行时依赖"：能用一个 `<script>` 跑起来的东西，不引入框架。

## 先跑起来

```bash
python build.py                  # 把 src/ 拼成 index.html + hardware.html
npm test                         # 纯 Node，不需要浏览器
npm run lint                     # ESLint
```

要求：Python 3.8+、Node 18+。`npm test` 只用到 Node 标准库，`npm install` 只是为了 lint 和截图工具。

想在真实浏览器里做交互验证、或重新生成 README 截图，需要 puppeteer：

```bash
npm install                      # 会下载 Chrome（约 150 MB，只下一次）
npm run verify                   # 验证 F12 跳转、新建文件夹等交互
npm run shots                    # 重新生成 docs/screenshots/*.png
```

## 代码约定

- `src/` 下的四个 JS 用 **一个 IIFE + 函数声明**组织，不拆模块、不引依赖，保持"拼起来就能跑"。
- 统一 ES5 写法（`var` / `function`），避免让老浏览器或离线场景掉队；新语法只在确实必要时用。
- `try { ... } catch (e) {}` 允许空 catch（localStorage、selectionRange 这类不可用就静默降级），其他空块 ESLint 会报错。
- 中文注释、中文报错：这是面向初学者的工具，报错要能直接看懂。
- 不提交 `node_modules`、`__pycache__`、`.probe`。

## 改完之后

1. `python build.py`：**构建产物 `index.html` / `hardware.html` 要一起提交**，GitHub Pages 直接发布根目录文件。
2. `npm test` + `npm run lint`：全过再提 PR。
3. 改了界面就重新截图（`npm run shots`），否则 README 会和实际界面对不上。

## 加一个例程

在 `src/examples.js` 里按现有结构追加一个对象即可，需要这些字段：

```js
{
  id: 'led-on',          // 唯一、短横线命名，分享链接用它
  title: '点亮第一个 LED',
  chapter: '端口输出与低电平点亮',
  goal: '运行后，开发板上 D1（P2.0）保持点亮……',
  points: ['……'],        // 3~5 条，讲清"为什么"
  quiz: ['……'],          // 1~2 个可以动手改的问题
  code: `#include <REGX52.H>\n...`
}
```

新例程会自动进入 `test-examples.js` 的回归（它会把所有例程编译并跑一小段），只要例程本身写得对，不用额外加测试。

## 提交信息

用一句话说清"做了什么"，中文即可：

```
工程树支持多级文件夹
修复 F12 跳转被同名符号表覆盖
补 CI：构建 + lint + 三套回归
```

不必逐条拆得很细，但不要把无关改动塞进同一个提交。

## 版权

提交 PR 即表示同意以 MIT 协议发布你的改动。例程与讲义请只用自己写的内容，不要复制他人课程原文。
