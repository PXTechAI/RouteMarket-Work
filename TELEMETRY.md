# RouteMarket Work telemetry

**English** · [简体中文](TELEMETRY.zh-CN.md)

RouteMarket Work source, development, local, and test builds do not send usage analytics by default. An official desktop release sends analytics only when its build provides both `ROUTEMARKET_WORK_UMAMI_HOST` and `ROUTEMARKET_WORK_UMAMI_WEBSITE_ID`.

The Electron main process sends allowlisted events directly to a self-hosted Umami endpoint. The application does not load remote analytics JavaScript.

## Collected events

- application opened;
- login or registration flow started;
- display language changed;
- project or conversation created;
- message dispatched;
- workflow run started;
- Marketplace plugin installed.

Events may include the application version, build environment, operating system, CPU architecture, display language, project/standalone scope, and boolean feature flags such as whether an attachment, agent, or web search was used.

## Data not collected

RouteMarket Work does not place prompts, responses, filenames, file paths, project names, conversation titles, browser URLs, credentials, account identifiers, or local file contents in analytics events. The Umami deployment may derive limited session or network metadata from a request, according to its server configuration and retention policy.

## Disabling analytics

- Build from source without the two Umami build variables; analytics remains disabled.
- Set `ROUTEMARKET_WORK_DISABLE_ANALYTICS=1` when launching the desktop application.
- RouteMarket Work also honors the conventional `DO_NOT_TRACK=1` environment variable.

The Website ID embedded in an enabled release is a public routing identifier, not a secret. Private credentials and signing keys must never be placed in analytics configuration.
