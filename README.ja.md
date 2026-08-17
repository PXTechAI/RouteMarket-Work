# RouteMarket Work

[简体中文](README.zh-CN.md) · [English](README.md) · **日本語** · [Español](README.es.md) · [Português](README.pt-BR.md) · [ไทย](README.th.md) · [한국어](README.ko.md)

RouteMarket Work は、AI を活用したプロジェクトと自動化のための、オープンソースかつローカルファーストなデスクトップワークスペースです。プロジェクトファイル、Agent との会話、ビジュアルワークフロー、ブラウザー操作、ローカルツール、MCP サーバー、Skill、承認フローを一つの Electron アプリに統合します。

> [!IMPORTANT]
> 本プロジェクトは現在活発に開発中です。アカウント、モデル、Agent、クラウド実行の一部には互換性のある RouteMarket サービスが必要です。安定版までに UI やローカルデータ形式が変更される可能性があります。

## 主な機能

- ローカルフォルダーを任意で関連付けられるローカルファーストのプロジェクト
- ファイル、検索、パッチ、プロセス、ブラウザー、MCP、Skill ツールを使う AI チャット
- ローカル／クラウドのビジュアルワークフローと実行履歴
- 分離プロファイルまたはローカル Chromium への接続によるブラウザー自動化
- MCP、プロジェクト Skill、ローカルトリガー、ネイティブアプリ連携
- ポリシーチェック、明示的な承認、クラウド送信前の情報マスキング

## クイックスタート

Node.js 22、Corepack、pnpm 10.8.1 が必要です。

```bash
corepack enable
corepack pnpm install
corepack pnpm dev:web
```

`dev:web` はモックデータを使う UI プレビューです。Electron 統合を起動するには `corepack pnpm dev` を実行してください。既定では互換性のある RouteMarket Web（`http://localhost:3000`）と API（`http://127.0.0.1:3001`）が必要です。

## セキュリティとライセンス

信頼できる操作とサービスだけを承認してください。認証情報、署名証明書、データベース、ログ、`.env` ファイルをコミットしないでください。脆弱性は [SECURITY.md](SECURITY.md) に従って非公開で報告してください。公式リリースの利用統計と無効化方法は [TELEMETRY.md](TELEMETRY.md) を参照してください。

本プロジェクトは [Apache License 2.0](LICENSE) で提供されます。このライセンスは RouteMarket の名称、ロゴ、その他のブランド資産に対する権利を付与しません。
