# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the TypeScript MCP server. `src/index.ts` registers tools and transports; manager modules handle projects, snapshots, history, and analysis; shared contracts live in `src/types.ts`. Compiled output goes to ignored `dist/`. Integration tests are in `test/`, while `test_mcp_json_fix.js` is a focused root-level protocol check. Setup helpers and user documentation live at the repository root.

## Build, Test, and Development Commands

- `npm install` installs dependencies (Node 18+).
- `npm run dev` runs the MCP server directly from `src/index.ts` with `tsx`.
- `npm run build` compiles strict TypeScript into `dist/`.
- `npm start` starts the compiled stdio server.
- `npm run lint` performs a no-output TypeScript type check.
- `npm run test:quick` runs the short core snapshot workflow.
- `npm test` runs the full workflow; `npm run test:js` exercises MCP tools over JSON-RPC.

Build before running integration tests. Tests require Linux shell utilities, write access to `/tmp`, and `rsync` for project snapshots.

## Coding Style & Naming Conventions

Use two-space indentation, single-quoted strings, semicolons, and explicit types at public boundaries. Use `PascalCase` for classes and exported types, `camelCase` for functions and variables, and descriptive filenames such as `projectSnapshotManager.ts`. Retain `.js` suffixes in ESM imports. Send diagnostics to stderr (`console.error`); stdout is reserved for MCP JSON-RPC.

## Testing Guidelines

Tests are end-to-end scripts; no coverage gate is configured. Name new workflows `test_<behavior>.sh` or `test_<behavior>.js`. Use isolated `/tmp/coderecoder_*` fixtures, clean them afterward, and validate responses and restored contents. Run `npm run lint`, `npm run build`, and the relevant workflow before submitting.

## Commit & Pull Request Guidelines

History uses concise summaries, sometimes with Conventional Commit prefixes. Prefer focused, imperative messages such as `fix: preserve snapshot chain on restore`. Pull requests should explain the change, list verification commands, link issues, and call out MCP schema or configuration changes. Include terminal output for protocol changes; add screenshots only for visible output changes.

## Runtime Data & Security

Never commit `.CodeRecoder/`, `.env*`, logs, test artifacts, or generated `dist/` files. Avoid destructive restore tests against real projects; use disposable fixtures and verify absolute paths before snapshot or rollback operations.
