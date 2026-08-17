# RouteMarket Work

[简体中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · **Español** · [Português](README.pt-BR.md) · [ไทย](README.th.md) · [한국어](README.ko.md)

RouteMarket Work es un espacio de trabajo de escritorio, de código abierto y con enfoque local-first, para proyectos y automatizaciones asistidos por IA. Reúne archivos de proyecto, conversaciones con agentes, flujos visuales, tareas de navegador, herramientas locales, servidores MCP, skills y aprobaciones en una aplicación Electron.

> [!IMPORTANT]
> El proyecto está en desarrollo activo. Algunas funciones de cuenta, modelos, agentes y ejecución en la nube requieren servicios RouteMarket compatibles. La interfaz y los formatos de datos locales pueden cambiar antes de una versión estable.

## Funciones principales

- Proyectos locales con vinculación opcional a una carpeta del equipo.
- Chat de IA con herramientas de archivos, búsqueda, parches, procesos, navegador, MCP y skills.
- Flujos de trabajo visuales locales o en la nube, con estado de ejecución y borradores reutilizables.
- Automatización mediante perfiles de navegador aislados o un Chromium local conectado.
- Integración con MCP, skills de proyecto, activadores locales y aplicaciones nativas.
- Comprobaciones de permisos, aprobaciones explícitas y redacción de diagnósticos antes de enviarlos a la nube.

## Inicio rápido

Requiere Node.js 22, Corepack y pnpm 10.8.1.

```bash
corepack enable
corepack pnpm install
corepack pnpm dev:web
```

`dev:web` ofrece una vista previa con datos simulados. Para la integración completa de Electron, ejecuta `corepack pnpm dev`. De forma predeterminada necesita una Web RouteMarket compatible en `http://localhost:3000` y una API en `http://127.0.0.1:3001`.

## Seguridad y licencia

Aprueba únicamente operaciones y servicios de confianza. No confirmes credenciales, certificados de firma, bases de datos, registros ni archivos `.env`. Informa vulnerabilidades de forma privada según [SECURITY.md](SECURITY.md). La telemetría de las versiones oficiales y sus opciones de desactivación se describen en [TELEMETRY.md](TELEMETRY.md).

El proyecto se distribuye bajo la [licencia Apache 2.0](LICENSE). La licencia no concede derechos sobre los nombres, logotipos u otros activos de marca de RouteMarket.
