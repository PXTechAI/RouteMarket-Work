# RouteMarket Work release checklist

This checklist keeps the open-source Desktop repository, the RouteMarket Core migration, and the signed release artifacts separate and reviewable.

## 1. Core compatibility first

- Merge the Core change that scopes `DesktopProjectBinding.bindingId` by Runtime.
- Keep the Prisma schema change and `20260815143000_scope_desktop_project_binding_ids` migration in the same Core change.
- Deploy the migration through the approved migrator workflow. Do not edit production tables or indexes manually.
- Run Core's Work service tests and `pnpm run db:validate` before deploying Core.
- Release the compatible Core version before distributing the matching Desktop build.

## 2. Recommended Desktop commit groups

1. `chore(repo): prepare the desktop repository for open source`
   - ignore rules, license, security policy, READMEs, environment example, and telemetry disclosure;
2. `feat(desktop-shell): add native title bar, authentication shell, settings, and locales`
   - RouteMarket Work brand, File/Edit/View/Help menus, login/logout, theme, language picker, and rail layout;
3. `feat(chat): support standalone and recent conversations`
   - project-independent chats, recent list, persistence, move/rename/delete, and data-scope isolation;
4. `feat(marketplace): add signed declarative plugin installation`
   - plugin manifest, publisher-key verification, catalog client, development fixture, and installer lifecycle;
5. `feat(local-tools): add artifact preview and workflow capabilities`
   - PDF/XLSX preview, spreadsheet operations, local workflow runtime, triggers, browser, MCP, and Agent integration;
6. `feat(analytics): add release-only privacy-bounded usage analytics`
   - build configuration, main-process Umami sender, allowlisted events, tests, and runtime opt-out;
7. `chore(release): prepare and verify the signed desktop candidate`
   - version, update metadata, signature verification, release notes, and final smoke-test evidence.

Files such as `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, and `apps/desktop/src/shared/desktop-api.ts` contain changes from several groups. Stage their individual hunks instead of adding the entire files to the first matching commit.

## 3. Never commit

- `.env` or `.env.*` files other than `.env.example`;
- signing private keys, certificates, tokens, or credentials;
- `out`, `release`, `release-*`, `tmp`, runtime databases, logs, dumps, or user data;
- generated Marketplace ZIP packages, local fixtures, downloaded plugins, or plugin dependencies/build output.

Commit first-party plugin source, manifests, tests, and required static assets under `plugins/`.

## 4. Automated gates

Run from the Desktop repository:

```bash
corepack pnpm --filter @routemarket/work-desktop typecheck
corepack pnpm --filter @routemarket/work-desktop test
corepack pnpm --filter @routemarket/work-desktop build:release
```

Before packaging, provide release values through a local ignored environment file or CI secrets. A Windows installer candidate must also pass the existing `dist:win` signature and update-metadata checks.

## 5. Manual smoke test

- launch, move, minimize, maximize, and close the frameless window;
- open File/Edit/View/Help menus and verify keyboard shortcuts;
- log in, cancel browser authorization, log out, and confirm the login page returns without stale requests;
- switch every supported locale and verify the language menu is visible outside the settings card;
- create a standalone conversation, a project conversation, and move a conversation between scopes;
- switch account spaces and confirm local chats, projects, browser data, and settings stay isolated;
- install, disable, enable, validate, and remove a signed development plugin;
- preview PDF and XLSX files, switch workbook sheets, and reject unsafe or oversized inputs;
- create and run a local workflow, inspect artifacts, cancel, resume, and retry;
- verify a release build sends only allowlisted analytics events and honors `ROUTEMARKET_WORK_DISABLE_ANALYTICS=1` and `DO_NOT_TRACK=1`.

## 6. Final disclosure and leakage scan

- confirm all README language variants link to `SECURITY.md` and `TELEMETRY.md`;
- scan tracked and untracked-to-be-committed files for private keys, tokens, real local paths, databases, and production-only values;
- confirm the Umami Website ID is absent from source and ordinary local builds;
- confirm an analytics-enabled release contains the endpoint only in the Electron main bundle and does not load remote JavaScript.

---

# 发布顺序摘要

先发布 Core 的 `binding_id` 作用域迁移，再发布对应桌面版本。数据库变更只能通过 migrator 执行，不手工操作生产库。桌面仓库按开源基础、桌面壳层、独立对话、Marketplace、文件与工作流、Analytics、发布候选七组提交；正式打包前完成全量自动测试、Windows 签名验证和手工冒烟测试。
