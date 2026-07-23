# Desktop 发布候选流程

正式 Windows 发布候选使用以下命令：

```powershell
$env:ROUTEMARKET_WORK_UPDATE_URL = "https://<正式更新源>/work"
$env:ROUTEMARKET_WORK_UPDATE_CHANNEL = "stable" # 或 beta
$env:ROUTEMARKET_WORK_ROLLOUT_PERCENT = "10"    # 1-100
$env:CSC_LINK = "<代码签名证书路径或安全引用>"
$env:CSC_KEY_PASSWORD = "<由 CI 密钥库注入>"
corepack pnpm dist:win
```

该命令首先检查远程 HTTPS 更新源、stable/beta 通道、灰度比例和代码签名凭据，然后
只允许在干净的 Git 工作区运行。它依次完成锁定生产端点的构建、已签名 NSIS x64
安装包、electron-updater 元数据和发布清单。未提交源码、缺少签名、使用本地更新
源、最终安装包 Authenticode 校验失败或给旧安装包重新标记新提交都会直接终止
流程。

## 发布清单

安装包旁会生成同名清单：

```text
release/
  RouteMarket Work-Setup-0.2.0-x64.exe
  RouteMarket Work-Setup-0.2.0-x64.manifest.json
  latest.yml # beta 通道为 beta.yml
```

清单包含：

- 清单格式版本；
- 产品与应用版本；
- 发布渠道、平台和架构；
- UTC 构建完成时间；
- 完整 Git commit；
- 构建时工作区是否干净；
- 安装包文件名、字节数和 SHA-256。
- 更新通道、灰度百分比和更新源 Origin（不记录私有路径或签名凭据）。

发布或上传前必须确认清单中的 `source.dirty` 为 `false`，安装包文件名与实际文件
一致，并重新运行以下测试：

```powershell
corepack pnpm test:release
```

开发期验证打包继续使用 `corepack pnpm dist:win:dir`。它不会生成正式发布清单，
也不能作为发布候选。

## 更新与灰度

- 正式构建每 6 小时检查一次签名更新；开发构建不会访问更新源。
- `stable` 使用 `latest.yml`，`beta` 使用 `beta.yml`，两个通道不会共用元数据。
- `ROUTEMARKET_WORK_ROLLOUT_PERCENT` 会写入 electron-updater 的
  `stagingPercentage`，同一设备会稳定落在同一灰度分组。
- 更新默认不静默下载。用户确认后下载，签名和哈希验证通过后才提示重启安装。
- NSIS 覆盖升级保留 `userData/worker`；卸载默认不删除应用数据，避免误删本地项目
  记录。项目文件始终在用户选择的原文件夹中，不属于卸载范围。

## 回滚

不得关闭签名校验或允许客户端任意降级。需要回滚时，从最后一个已验证提交恢复
源码，生成一个版本号更高的紧急修复版本，重新签名、生成清单并先以较小灰度发布。
确认数据库迁移和启动冒烟通过后再扩大到 100%。更新源必须保留前一稳定版本的
安装包、清单和 SHA-256，直到新版本完成全量观察期。

每个发布候选至少执行：

```powershell
corepack pnpm test
corepack pnpm build
corepack pnpm test:release
```

另需在干净虚拟机验证首次安装、同路径覆盖升级、保留旧本地数据、卸载后项目文件
仍存在，以及从更新提示到重启安装的完整链路。

Windows 一次性虚拟机可以运行：

```powershell
.\scripts\test-windows-installer.ps1 `
  -PreviousInstaller .\release\previous.exe `
  -CurrentInstaller ".\release\RouteMarket Work-Setup-0.2.0-x64.exe" `
  -ConfirmDisposableVm
```

脚本会先验证两个安装包的 Authenticode 签名，再执行首次安装、同目录覆盖升级与静默
卸载，并确认应用数据探针和应用外部的项目文件都未被删除。该脚本故意要求
`-ConfirmDisposableVm`，禁止在日常开发机上误运行。
