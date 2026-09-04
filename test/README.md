# CodeRecoder Test Suite

The canonical suite uses Node's built-in test runner and disposable directories under the operating-system temp root.

```bash
npm test           # build and run every current test
npm run test:quick # backup engine and automatic watcher
npm run test:mcp   # MCP initialize, tool metadata, validation, and calls
npm run test:desktop # Electron controller activation, restore, and evidence
```

`backup-system.test.js` covers:

- files, binary bytes, directories, modes, symlinks, exclusions, and inferred renames;
- exact restore with preview confirmation and a pre-restore safety backup;
- rejection after source changes or token expiry;
- corruption detection;
- concurrent manager/index writes, corrupt-index rebuilding, and interrupted deletion recovery;
- startup rollback from an interrupted-restore journal;
- automatic-checkpoint debounce, pause, event discard, and internal-storage recursion prevention.

`mcp-server.test.js` connects a real SDK client and server with an in-memory transport. It verifies the initialize lifecycle, server instructions, the production tool list, output schemas, destructive annotations, structured errors, input validation, activation, listing, and deactivation.

`stdio-smoke.test.js` starts the compiled executable as a child process, performs the JSON-RPC initialize lifecycle, verifies the tool list, checks that stdout contains only protocol messages, and confirms clean shutdown on stdin EOF.

`desktop-controller.test.ts` exercises the Electron-facing controller without a browser. It verifies activation, persisted preferences, snapshot creation, preview-token restore, recovery evidence, integrity checks, and deactivation.

The older shell and JSON-RPC scripts remain only as migration fixtures for the removed pre-v3 tool surface. They are not part of `npm test`; `npm run test:legacy` may fail by design until a downstream user migrates those calls.

When adding tests, never restore into this repository or another real project. Create both the source fixture and external backup root under a fresh temp directory, register cleanup with `t.after`, and assert persisted files in addition to API responses.
