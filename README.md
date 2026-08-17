# RouteMarket Work

[简体中文](README.zh-CN.md) · **English** · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [ไทย](README.th.md) · [한국어](README.ko.md)

RouteMarket Work is an open-source, local-first desktop workspace for AI-assisted projects and automation. It brings project files, agent conversations, visual workflows, browser tasks, local tools, MCP servers, skills, and approvals into one Electron application.

> [!IMPORTANT]
> RouteMarket Work is in active development. Some account, model, agent, and cloud-execution features require compatible RouteMarket services. Interfaces and local data formats may change before a stable release.

## Highlights

- **Local-first projects** — create projects, optionally bind a local folder, and keep project conversations and execution state on the device.
- **AI project chat** — work with agents and models using project-aware file, search, patch, process, browser, MCP, and skill tools.
- **Visual workflows** — compose and run local or cloud workflows, inspect execution state, and keep reusable workflow drafts.
- **Browser automation** — use isolated managed-browser profiles or attach to a local Chromium debugging endpoint.
- **Extensible local runtime** — connect MCP servers, install project skills, configure local triggers, and launch supported native applications.
- **Permission boundaries** — route local mutations through explicit policy checks and approval flows; keep cloud-bound diagnostics redacted.
- **Desktop packaging** — Electron-based Windows packaging and a macOS build target.

## Architecture

```text
Electron renderer
      │ typed preload API
Electron main process
      ├── local projects, chat, workflows, browser and credentials
      ├── permission and approval broker
      └── RouteMarket API client
              │
      utility-process worker
              ├── project file tools and process management
              ├── MCP host
              └── local skill runtime
```

The renderer does not import Node.js capabilities directly. Local privileged operations stay behind typed IPC contracts in the preload, main, and worker layers.

## Getting started

### Requirements

- Node.js 22
- Corepack
- pnpm 10.8.1 (declared by the workspace)
- Windows for the currently exercised installer flow; macOS is also configured as a build target

Install dependencies:

```bash
corepack enable
corepack pnpm install
```

Start the renderer-only preview with mock desktop data:

```bash
corepack pnpm dev:web
```

Start the Electron application:

```bash
corepack pnpm dev
```

Electron development expects a compatible RouteMarket web service at `http://localhost:3000` and API at `http://127.0.0.1:3001` by default.

## Quality checks

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Privacy and security

RouteMarket Work can access local files, processes, browsers, MCP servers, and cloud services. Review every approval request and only connect services you trust. Never commit credentials, signing certificates, runtime databases, logs, or `.env` files. Please report vulnerabilities according to [SECURITY.md](SECURITY.md). Official-release usage analytics and opt-out controls are documented in [TELEMETRY.md](TELEMETRY.md).

## Contributing

Issues and focused pull requests are welcome. Before submitting a change, keep Electron privileges behind the typed preload boundary, add focused tests, and run the quality checks above.

## License

Licensed under the [Apache License 2.0](LICENSE). The license covers the source code, not RouteMarket names, logos, or other brand assets except as required for reasonable attribution.
