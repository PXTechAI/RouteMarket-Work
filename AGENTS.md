# RouteMarket Work Engineering Rules

## Renderer architecture

- Follow `docs/renderer-architecture.md` for all desktop renderer work.
- Do not add new feature UI directly to `apps/desktop/src/renderer/src/App.tsx`.
- Keep `App.tsx` focused on application bootstrap, shared state orchestration, and page composition.
- Split renderer code by page or feature domain. Keep page-specific components, hooks, types, and styles inside that domain.
- Keep component styles next to the component or page that owns them. Global CSS is limited to design tokens, resets, typography, and truly shared primitives.
- Reuse existing components and patterns before adding a new shared abstraction.
- Preserve the Electron main/preload/renderer security boundary. Renderer components must use typed preload APIs rather than importing Node.js capabilities directly.

## Product styling

- RouteMarket brand colors come from the Core design tokens. The current primary accent is `#4162ff`, with `#6d8cff` as the stronger accent and `#4162ff -> #7b61ff -> #a855f7` as the brand gradient.
- Green is reserved for success and online status. It is not the RouteMarket primary brand color.
- Desktop layouts should prioritize dense, efficient work surfaces over marketing composition.
