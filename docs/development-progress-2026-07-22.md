# RouteMarket Work 开发进度（2026-07-22）

## 本轮已完成

- 开发模式默认使用本地服务：Work API 为 `http://127.0.0.1:3001`，网页登录为 `http://localhost:3000`。网页登录固定使用 `localhost`，以便与本地 Web 登录会话 Cookie 保持同一站点。
- 生产构建继续使用 `https://console.routemarket.ai`，并支持分别通过 `ROUTEMARKET_WORK_API_URL` 和 `ROUTEMARKET_WORK_WEB_URL` 覆盖。
- 登录、项目聊天、Cloud Worker 和云工作流已统一通过主进程 `RouteMarketApiClient` 请求；统一处理地址、令牌与桌面客户端标识，不进行线上回退。
- 修复本地桌面登录入口使用 `127.0.0.1` 导致与 `localhost` 登录会话分离的问题；本地 Windows 测试包已重新生成。
- 修复 Windows 下 Worker、MCP 子进程退出后项目目录仍被占用的问题。
- 活动中心对五分钟内相同错误进行合并计数，启动时压缩历史重复错误，并新增一键清空。
- 云端重连退避上限从 30 秒调整为 5 分钟，避免服务异常时持续刷请求和错误消息。
- 完全删除旧的全局 `styles.css`，将页面样式迁移到令牌、基础组件和功能模块样式；不保留兼容层。
- 补齐文件、MCP、终端等页面样式，使桌面端视觉统一到新版品牌令牌。
- 补齐聊天消息区、上下文条和底部输入区的模块化结构样式，并通过打包程序深色主题实机截图验证。
- 版本升级到 `0.2.0`，已生成 Windows x64 安装包。

## 验证结果

- 类型检查：通过。
- 生产构建：通过，产物不包含本地开发地址。
- 自动化测试：209 项通过，5 项按设计跳过。
- Windows NSIS 打包：通过。
- 打包程序运行时冒烟检查：通过；主窗口从 `app.asar` 加载，页面无溢出，品牌色令牌为 `#4162ff`，未加载旧 `styles.css`。
- 安装包：`release/RouteMarket Work-Setup-0.2.0-x64.exe`
- SHA-256：`281b4c8549ba4c1640e34965fbd7f96e4b8eaddac4fc96358476d654d7ebe336`

## 本地测试方式

本轮修改不需要部署 Stack。先在 RouteMarket Core 仓库启动本地 Web（3000）与 Core API（3001），再在本仓库执行 `corepack pnpm dev`；桌面开发模式会直接连接这两个本地服务。

## 下一阶段

Desktop V1 后续产品边界、优先级与验收标准统一记录在
[`desktop-next-iteration.md`](./desktop-next-iteration.md)。新一轮开发应从
P0 的开发验证、登录门禁和本地项目生命周期开始。
