# CLAUDE.md

Guidance for Claude Code when changing CodeRecoder.

## Product Contract

CodeRecoder is a code backup service, not a Git implementation or an AI analysis service. The production MCP tool surface is registered in `src/index.ts`. Do not re-expose the legacy file-history, simulated Serena, old GUI tools, or incremental-chain tools through MCP. The Vue/Electron app under `desktop/` is an independent local client and must keep using the production backup engine.

An active project belongs only to the current MCP process. Never persist or restore a globally active project. Project source must not require instrumentation; use `storageRoot` when backup metadata must remain outside the protected tree.

## Architecture

- `BackupManager` creates complete logical snapshots and owns manifests, SHA-256 verification, atomic indexes, retention, locks, restore tokens, safety backups, rollback, and startup recovery.
- `AutoCheckpointManager` watches the active tree, coalesces events, queues writes during backup, and performs periodic reconciliation.
- `CodeRecoderServer` exposes validated MCP tools, annotations, structured output, process-local activation, and watcher coordination.
- `DesktopBackupController` adapts the same managers for the Electron UI; preload exposes only typed, allowlisted IPC calls, and renderer code has no Node access.
- Older managers still compile for migration reference but are not production entry points. Their optional AI providers must remain explicitly unavailable unless a real transport and health check are implemented.

## Non-Negotiable Restore Invariants

1. `preview_project_restore` must verify the target and bind a short-lived token to the current tree hash, project, snapshot, and restore mode.
2. `restore_project_snapshot` must reject expired, reused, mismatched, or stale tokens.
3. A verified `protected` pre-restore snapshot and durable recovery journal must exist before source mutation.
4. Automatic monitoring must pause and discard restore-generated events.
5. Success requires byte/type/mode verification; failure requires rollback. Leave the recovery journal in place if rollback cannot be verified.
6. Exact restore may remove only scanned, non-excluded paths. Never recursively delete an ignored non-empty directory.

## Development

```bash
npm run lint       # strict TypeScript check
npm run build      # emit ESM into dist/
npm run test:quick # backup, restore, concurrency, recovery, watcher
npm run test:mcp   # real MCP initialize/list/call lifecycle
npm run test:desktop # desktop controller activation/restore lifecycle
npm run desktop:build # type-check and build Electron + Vue
npm test           # canonical full suite
```

Use two-space indentation, single quotes, semicolons, ESM imports with `.js` suffixes, and stderr for diagnostics. Keep MCP results truthful: return `isError: true` on failure and expose degraded watcher state rather than reporting simulated success.

Tests must use disposable directories under the OS temp root and external backup storage. Add coverage for both the successful operation and its interruption or rejection path. Run `git diff --check` before handoff.

## Safety and Compatibility

Do not follow symlinks while scanning. Validate all manifest paths through `safeJoin`. Preserve `.env*`, VCS metadata, dependencies, build output, caches, logs, and configured exclusions during restore. A schema or tool-name change is an MCP API change and must be reflected in `README.md`, `MCP_CONFIG_GUIDE.md`, and lifecycle tests.
