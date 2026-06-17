# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenCLI (`@jackwener/opencli`) converts websites and Electron apps into deterministic CLI commands. It reuses your Chrome login state — no API keys needed. 100+ site adapters are pre-built in `clis/`.

## Commands

```bash
npm run dev                     # Run CLI in dev mode (tsx)
npm run build                   # Clean dist, copy YAML, compile TS, generate cli-manifest.json
npm run typecheck               # tsc --noEmit (no emit, type-check only)
npm test                        # Default gate: unit + extension + adapter
npm run test:adapter            # Adapter tests only (useful when iterating on adapters)
npm run test:e2e                # E2E tests (requires build + real Chrome)
npm run test:all                # All tests including smoke
npm start                       # Run compiled dist/src/main.js
```

Run a single test file:
```bash
npm test -- --run clis/apple-podcasts/commands.test.ts
npx vitest run tests/e2e/management.test.ts
```

Watch mode for development:
```bash
npx vitest src/
```

E2E/smoke tests require `npm run build` first (they invoke `dist/src/main.js` as a subprocess).

## Architecture

### Core Flow

`src/main.ts` → `discovery.ts` (loads adapters from `clis/` + `~/.opencli/clis/` + plugins) → `cli.ts` (Commander.js wiring) → `execution.ts` (runs a command) → pipeline engine or browser func.

**Fast startup path**: `cli-manifest.json` (generated at build time) avoids filesystem scan in production. Falls back to scanning `clis/` directories in dev.

### Key Layers

- **Registry** (`src/registry.ts`): Global `Map<string, CliCommand>`. The `cli()` function registers commands. Strategy enum: `PUBLIC`, `LOCAL`, `COOKIE`, `INTERCEPT`, `UI`.
- **Adapters** (`clis/*.js`): Each site is a directory of `.js` files. Each file calls `cli()` with a `pipeline` (declarative) or `func` (imperative browser interaction). Adapters are plain JS, not TS.
- **Pipeline** (`src/pipeline/`): Declarative steps — `fetch`, `download`, `intercept`, `tap`, `transform`, `browser`. Template expressions use `${{ expr }}` syntax.
- **Execution** (`src/execution.ts`): Validates args, manages browser sessions, enforces timeouts, lazy-loads modules from manifest.
- **Browser** (`src/browser/`): CDP abstraction — `cdp.ts` (low-level), `page.ts` (IPage), `dom-snapshot.ts` (AI observation), `find.ts`/`extract.ts`/`shape.ts` (element interaction).
- **Daemon** (`src/daemon.ts`): HTTP + WebSocket micro-daemon (localhost:19825). CLI → HTTP POST → daemon → WebSocket → Chrome Extension → Chrome API.
- **Chrome Extension** (`extension/`): Manifest V3 service worker connecting daemon to Chrome via `chrome.debugger` API. Built separately with Vite.
- **Plugin System** (`src/plugin.ts`): `opencli plugin install github:user/repo`. Stored in `~/.opencli/plugins/`. Override order: built-in < user (`~/.opencli/clis/`) < plugins.
- **Output** (`src/output.ts`): `table`, `json`, `yaml`, `md`, `csv` formats.

### Test Structure (Vitest multi-project)

| Project | Location | What it tests |
|---------|----------|---------------|
| `unit` | `src/**/*.test.ts` | Core runtime, pipeline, output, registry |
| `extension` | `extension/src/**/*.test.ts` | Chrome extension |
| `adapter` | `clis/**/*.test.{ts,js}` | Site adapter logic |
| `e2e` | `tests/e2e/*.test.ts` | Full CLI subprocess tests |
| `smoke` | `tests/smoke/*.test.ts` | External API health, adapter registration |

## Code Conventions

- TypeScript strict mode, ESM with `.js` extensions in imports
- File naming: `kebab-case`; variables/functions: `camelCase`; types/classes: `PascalCase`
- Named exports only — no default exports
- Conventional Commits: `feat(scope):`, `fix(scope):`, `docs:`, `test(scope):`, `chore:`. Scopes are site name (`twitter`, `reddit`) or module (`browser`, `pipeline`, `engine`)
- Adapters must declare `access: 'read' | 'write'`
- No ESLint/Prettier — style is enforced by TS strict mode and conventions

## Adapter Authoring Quick Reference

**Pipeline adapter** (for data-fetching from APIs — recommended):
```js
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
  site: 'mysite', name: 'trending', description: '...',
  domain: 'www.mysite.com', strategy: Strategy.PUBLIC,
  args: [{ name: 'query', positional: true, required: true, help: '...' }],
  columns: ['title', 'url'],
  pipeline: [
    { fetch: { url: 'https://api.mysite.com/trending' } },
    { map: { title: '${{ item.title }}', url: '${{ item.url }}' } },
  ],
});
```

**Func adapter** (for complex browser interactions):
```js
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
  site: 'mysite', name: 'search', description: '...',
  domain: 'www.mysite.com', strategy: Strategy.COOKIE,
  args: [{ name: 'query', positional: true, required: true }],
  columns: ['title', 'url'],
  func: async (page, kwargs) => { /* browser automation */ },
});
```

See `clis/hackernews/top.js` for a real pipeline example.

**Arg design**: Positional for the primary required arg (query, symbol, id). Named `--flag` for optional config (limit, sort, page).

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENCLI_DAEMON_PORT` | `19825` | Daemon HTTP port |
| `OPENCLI_PROFILE` | — | Chrome profile alias |
| `OPENCLI_BROWSER_COMMAND_TIMEOUT` | `60` | Browser command timeout (seconds) |
| `OPENCLI_CDP_ENDPOINT` | — | Remote CDP endpoint for Electron apps |
| `OPENCLI_VERBOSE` | `false` | Verbose logging |
| `OPENCLI_E2E` | — | Set `1` to include extended E2E tests |
| `OPENCLI_AX_E2E` | — | Set `1` to include AX Chrome E2E tests |

## Exit Codes

`0` success, `1` generic error, `2` argument error, `66` empty result, `69` service unavailable, `75` timeout, `77` auth required, `78` config error, `130` Ctrl-C.
