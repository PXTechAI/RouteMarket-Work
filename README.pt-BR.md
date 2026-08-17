# RouteMarket Work

[简体中文](README.zh-CN.md) · [English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · **Português** · [ไทย](README.th.md) · [한국어](README.ko.md)

RouteMarket Work é um workspace desktop open source e local-first para projetos e automações com IA. Ele reúne arquivos de projeto, conversas com agentes, fluxos visuais, tarefas de navegador, ferramentas locais, servidores MCP, skills e aprovações em um único aplicativo Electron.

> [!IMPORTANT]
> O projeto está em desenvolvimento ativo. Alguns recursos de conta, modelos, agentes e execução em nuvem exigem serviços RouteMarket compatíveis. A interface e os formatos de dados locais podem mudar antes de uma versão estável.

## Principais recursos

- Projetos locais com vínculo opcional a uma pasta do computador.
- Chat com IA usando ferramentas de arquivos, busca, patches, processos, navegador, MCP e skills.
- Workflows visuais locais ou em nuvem, com estado de execução e rascunhos reutilizáveis.
- Automação por perfis de navegador isolados ou por conexão com um Chromium local.
- Integração com MCP, skills de projeto, gatilhos locais e aplicativos nativos.
- Verificações de permissão, aprovações explícitas e remoção de dados sensíveis antes do envio de diagnósticos à nuvem.

## Início rápido

Requer Node.js 22, Corepack e pnpm 10.8.1.

```bash
corepack enable
corepack pnpm install
corepack pnpm dev:web
```

`dev:web` abre uma prévia com dados simulados. Para a integração Electron completa, execute `corepack pnpm dev`. Por padrão, são necessários um serviço Web RouteMarket compatível em `http://localhost:3000` e uma API em `http://127.0.0.1:3001`.

## Segurança e licença

Aprove somente operações e serviços confiáveis. Não envie credenciais, certificados de assinatura, bancos de dados, logs ou arquivos `.env` ao repositório. Relate vulnerabilidades em privado conforme [SECURITY.md](SECURITY.md). A telemetria das versões oficiais e as opções para desativá-la estão descritas em [TELEMETRY.md](TELEMETRY.md).

O projeto é licenciado sob a [Apache License 2.0](LICENSE). A licença não concede direitos sobre nomes, logotipos ou outros ativos de marca da RouteMarket.
