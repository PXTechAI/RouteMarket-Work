# Desktop 发布候选流程

正式 Windows 发布候选使用以下命令：

```powershell
corepack pnpm dist:win
```

该命令只允许在干净的 Git 工作区运行，依次完成生产构建、NSIS x64 安装包生成和
发布清单生成。未提交的源码或未跟踪文件会在打包前直接终止流程。

## 发布清单

安装包旁会生成同名清单：

```text
release/
  RouteMarket Work-Setup-0.2.0-x64.exe
  RouteMarket Work-Setup-0.2.0-x64.manifest.json
```

清单包含：

- 清单格式版本；
- 产品与应用版本；
- 发布渠道、平台和架构；
- UTC 构建完成时间；
- 完整 Git commit；
- 构建时工作区是否干净；
- 安装包文件名、字节数和 SHA-256。

发布或上传前必须确认清单中的 `source.dirty` 为 `false`，安装包文件名与实际文件
一致，并重新运行以下测试：

```powershell
corepack pnpm test:release-manifest
```

开发期验证打包继续使用 `corepack pnpm dist:win:dir`。它不会生成正式发布清单，
也不能作为发布候选。
