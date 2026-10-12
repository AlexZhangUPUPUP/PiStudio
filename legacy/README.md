# legacy/ — retired code, kept for reference

Nothing here is used at runtime. It is archived rather than deleted so the
migration stays reviewable and reversible (this project is not under git).

## `vanilla-ui/`

The original zero-dependency frontend the React app replaced:

```
vanilla-ui/
  index.html · style.css · app.js · i18n.js
```

It was served from `public/`; `server.js` used to fall back to it when `dist/`
was missing. It is fully superseded by `src/` (React + TypeScript + Vite) —
see the "Frontend (React + Vite)" section of the root `README.md`.

To run it again, point a static server at this directory (it expects the
pi-gui API on the same origin). The visual language it ended on was the calm
light/dark theme; the `neobrutalist-ui-design/` project was an earlier source
design and the CSS override block was already empty.

## `dev/`

Test/QA scripts written for the vanilla UI. They drive the old DOM
(`#chat`, `.bubble`, …) and no longer match the React app:

- `cdp-test.mjs` — the 250-check end-to-end suite
- `css-audit.mjs` — measured UI audit (contrast, type scale, hit targets)
- `i18n-check.mjs` / `i18n-add.mjs` — translation key coverage against the old files
- `make-screenshots.mjs` — regenerated the README screenshots
- `multi-tab-test.mjs` — two clients on one session
- `shot-*.png` — the screenshots it produced

The React equivalents live in `dev/` at the repo root:

- `dev/react-smoke.mjs` — end-to-end smoke test (`npm test`)
- `dev/dialogs-demo.ts` — pi extension exercising every dialog (`/dialogtest`)
