# RouteMarket Work 使用情况统计

[English](TELEMETRY.md) · **简体中文**

RouteMarket Work 的源码构建、开发构建、本地构建和测试构建默认不会发送使用情况统计。只有正式桌面版在构建时同时提供 `ROUTEMARKET_WORK_UMAMI_HOST` 和 `ROUTEMARKET_WORK_UMAMI_WEBSITE_ID`，统计功能才会启用。

统计事件由 Electron 主进程直接发送至自托管 Umami 服务，应用不会加载远程统计 JavaScript。

## 收集的事件

- 应用启动；
- 开始登录或注册流程；
- 更改显示语言；
- 创建项目或对话；
- 发送消息；
- 开始运行工作流；
- 安装 Marketplace 插件。

事件可能包含应用版本、构建环境、操作系统、CPU 架构、显示语言、项目或独立对话范围，以及是否使用附件、Agent 或网页搜索等布尔功能标记。

## 不会收集的数据

RouteMarket Work 不会在统计事件中包含提示词、回复、文件名、文件路径、项目名称、对话标题、浏览器网址、凭据、账号标识或本地文件内容。Umami 服务可能根据其服务端配置和保留策略，从请求中生成有限的会话或网络信息。

## 关闭统计

- 从源码构建时不提供两个 Umami 构建变量，统计功能会保持关闭；
- 启动桌面应用时设置 `ROUTEMARKET_WORK_DISABLE_ANALYTICS=1`；
- RouteMarket Work 同样遵循通用的 `DO_NOT_TRACK=1` 环境变量。

启用统计的正式版本中所包含的 Website ID 只是公开的路由标识，并非密钥。不得在统计配置中放入私有凭据或签名密钥。
