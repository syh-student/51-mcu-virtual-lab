# 更新记录

## 未发布

### 新增

- 工程树支持多级文件夹：按文件路径自动分层（`src/led.c` 会缩进到 `src/` 里），并接上了原本没入口的「＋文件夹」「重命名文件夹」「删除文件夹」。
- 新建文件夹时记住所属分组，改名 / 删除会同步更新折叠状态与分组映射。
- 分享链接带上文件夹归属，别人打开时树形一致。

### 修复

- 修复 F12「跳转到定义」被自动补全的同名符号表覆盖，跳转行号变成 `undefined` 的问题；两张符号表改名为 `collectSymbols` / `completionSymbols`。
- 去掉 `hex2` 的重复定义（波形区改用 `hex2Byte`），端口读数不再出现 `NaN` 兜底路径。
- 清理未使用的 `pageInited` / `scopeEl` / `self` 变量。

### 工程化

- 新增 `package.json`：`build` / `test` / `lint` / `shots` / `verify` 五个脚本。
- 新增 ESLint 配置（`no-redeclare` / `no-dupe-keys` / `no-unused-vars` 等），源码零告警。
- 新增 GitHub Actions：构建 → 校验产物无占位符 → lint → 三套回归。
- 新增 Issue / PR 模板、`CONTRIBUTING.md`、`LICENSE`（MIT）、`.editorconfig`、`.gitattributes`。

### 文档

- 重写 README：真实截图、架构说明、能力边界、路线图。
- 新增 `docs/screenshots/` 与 `tools/shots.js`：截图可一键复现，不再是"手工贴图"。

### 测试

- `test-ui.js` 增加 4 条文件夹相关断言（建文件夹、文件入夹、缩进层级、不重复出现）。
- 新增 `tools/verify.js`：在真实浏览器里验证 F12 跳转、文件夹树、事件接线。

## 1.0.0 — 2026-11-16

首个公开版本：C51 教学级解释器、Keil 式多文件工程、虚拟开发板与引脚板、时序图、硬件实验室、15 个配套例程、GitHub Pages 在线体验。
