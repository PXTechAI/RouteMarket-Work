# RouteMarket Work Renderer Architecture

This document defines how the Electron renderer is organized as RouteMarket Work grows across chat, workflows, browser automation, local tools, MCP, agents, and project editing.

## Goals

- Make each product surface easy to find, understand, test, and replace.
- Prevent `App.tsx` and a single global stylesheet from becoming the implementation of every page.
- Keep desktop-only capabilities independent from RouteMarket Core while preserving typed API contracts.
- Let open-source contributors work on one surface without loading the entire application into one file.

## Required directory structure

```text
apps/desktop/src/renderer/src/
  app/
    App.tsx
    AppShell.tsx
    app-shell.css
  components/
    account/
    controls/
    feedback/
  features/
    projects/
      components/
      hooks/
      projects.css
    chat/
      components/
      hooks/
      chat.css
    workflows/
      components/
      hooks/
      workflows.css
    browser/
      components/
      hooks/
      browser.css
    terminal/
    mcp/
    approvals/
    files/
  styles/
    tokens.css
    reset.css
    primitives.css
  main.tsx
```

The structure may be introduced incrementally. New work must follow it even while legacy code is being migrated.

## File responsibilities

### `App.tsx`

`App.tsx` may:

- initialize the typed desktop API;
- own application-wide session and selection state;
- coordinate data shared by multiple pages;
- compose the application shell and active feature page.

`App.tsx` must not:

- contain full page markup;
- contain large feature-specific forms, lists, canvases, or toolbars;
- define reusable visual components;
- accumulate page-specific helper functions that can live in a feature module.

### Feature pages

Each major surface has a directory under `features/`. A feature owns:

- its page component;
- feature-specific child components;
- feature hooks and local state helpers;
- feature types that are not shared contracts;
- feature tests;
- feature-specific CSS.

Examples include chat, workflow, browser, terminal, MCP, approvals, files, and projects.

### Shared components

Place a component under `components/` only when at least two feature domains use it or when it is an application-level primitive. A component used by one page stays with that page.

### Styles

- `styles/tokens.css` contains RouteMarket colors, spacing, typography, shadows, and z-index tokens.
- `styles/reset.css` contains document and element normalization only.
- `styles/primitives.css` contains genuinely shared controls such as icon buttons and common focus rings.
- Page and component styles live beside their owner and use a feature-prefixed class name.
- Do not add feature-specific selectors to a global `styles.css`.
- Green means success, connected, or online. RouteMarket primary actions use the Core blue-purple accent tokens.

## Size and extraction guidance

These are review thresholds, not automatic failures:

- Extract a React component when a JSX region represents a named product concept or grows beyond roughly 120 lines.
- Extract a hook when effects and event handlers form a reusable lifecycle or exceed roughly 80 lines.
- Review files above 400 lines for another page, component, hook, or utility boundary.
- Avoid components with more than 12 independent props. Prefer a typed view model or a feature hook when the values belong together.

## State ownership

- Keep transient visual state in the nearest component that uses it.
- Keep feature state in the feature page or feature hook.
- Lift state to the app shell only when multiple feature pages need the same source of truth.
- Keep Electron and local capability calls behind `RouteMarketWorkApi`.
- Core remains the source for cloud account, membership, models, and orchestration contracts. Desktop remains the source for local execution state.

## Tests

- Put component and helper tests next to the feature they cover.
- Add focused tests for model selection, disabled states, page switching, and desktop capability boundaries.
- Run desktop type checking, tests, and a local build before committing renderer architecture changes.

## Migration rule

Do not rewrite all legacy renderer code in one change. When modifying an existing area:

1. Extract the page or component being changed.
2. Move only its owned styles.
3. Preserve behavior and typed desktop API calls.
4. Verify the affected page before extracting the next area.
