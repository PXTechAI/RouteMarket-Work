# RouteMarket Work

**简体中文** · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [ไทย](README.th.md) · [한국어](README.ko.md)

RouteMarket Work 是一个开源、本地优先的 AI 项目与自动化桌面工作台。它将项目文件、Agent 对话、可视化工作流、浏览器任务、本地工具、MCP 服务、Skill 和操作审批整合在一个 Electron 应用中。

> [!IMPORTANT]
> 项目仍在快速开发中。账户、模型、Agent 和云端执行等部分功能需要兼容的 RouteMarket 服务；稳定版发布前，界面和本地数据格式仍可能变化。

## 核心能力

- **本地优先项目**：创建项目并按需绑定本地文件夹；项目对话和执行状态默认保存在设备上。
- **AI 项目对话**：让 Agent 在项目范围内调用文件读取、搜索、补丁、进程、浏览器、MCP 和 Skill 工具。
- **可视化工作流**：编辑和运行本地或云端工作流，查看执行状态并保存可复用草稿。
- **浏览器自动化**：使用隔离的托管浏览器配置，或连接本机 Chromium 调试端口。
- **可扩展本地运行时**：连接 MCP 服务、安装项目 Skill、配置本地触发器并启动受支持的原生应用。
- **权限边界**：本地修改操作经过策略检查和审批流程，上传云端的诊断信息会先脱敏。
- **桌面打包**：基于 Electron，当前重点验证 Windows 安装包，并配置了 macOS 构建目标。

## 快速开始

需要 Node.js 22、Corepack 和 pnpm 10.8.1。

```bash
corepack enable
corepack pnpm install
corepack pnpm dev:web
```

`dev:web` 使用模拟桌面数据，适合界面开发。运行完整 Electron 集成：

```bash
corepack pnpm dev
```

默认情况下，Electron 开发模式需要兼容的 RouteMarket Web 服务（`http://localhost:3000`）和 API（`http://127.0.0.1:3001`）。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## 隐私、安全与许可

本软件可以访问本地文件、进程、浏览器、MCP 服务和云服务。请只批准可信操作，切勿提交凭据、签名证书、运行时数据库、日志或 `.env` 文件。漏洞请按 [SECURITY.md](SECURITY.md) 私下报告。正式版的使用情况统计范围和关闭方式见 [TELEMETRY.zh-CN.md](TELEMETRY.zh-CN.md)。

项目采用 [Apache License 2.0](LICENSE)。许可证授权源代码，不授权 RouteMarket 名称、Logo 或其他品牌资产，但合理署名所必需的使用除外。
