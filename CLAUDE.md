# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## CodeRecoder Architecture

CodeRecoder is an AI-enhanced code version management system built on the **Model Context Protocol (MCP)**. It provides instant file snapshots, project-level version control, and smart change detection, similar to Cursor's multi-round generation and rollback features.

### Core Design Principles

1. **Manager-Based Architecture**: Each major function (file snapshots, project snapshots, history tracking, project activation) is handled by a dedicated manager class in `src/`:
   - `ProjectManager` - Global project workspace management and activation
   - `FileSnapshotManager` - High-performance file-level snapshots via direct file copying
   - `ProjectSnapshotManager` - Cursor-style project snapshots with incremental/full strategies
   - `HistoryManager` - Traditional edit history tracking (legacy support)
   - `DataStructureManager` - Project directory structure and configuration
   - `AIAnalysisService` - Serena integration for code analysis

2. **Project-Isolated Data**: Each activated project maintains its own `.CodeRecoder/` directory containing:
   - `config/` - Project settings and metadata
   - `snapshots/files/` - File-level snapshots organized by session
   - `snapshots/projects/` - Complete project snapshots
   - `history/` - Edit history records
   - `analysis/` - AI-generated insights
   - `logs/` - Debug and error logs

3. **Direct File Copying**: File snapshots use direct file system copying (not content parsing) for sub-50ms performance. This means snapshot operations don't parse file contents.

4. **Four-Way Change Detection**: Project snapshots use intelligent detection:
   - Git status changes
   - File stat comparison (size, mtime)
   - Content SHA256 hashing
   - Timestamp-based recent file scanning

5. **Incremental + Full Snapshot Strategy**: Project snapshots can be incremental (only changed files) or full (all files). Incremental snapshots maintain dependency chains for complete restoration.

## Development Commands

### Build and Run
```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Run with tsx for development (hot reload)
npm start        # Run compiled server (node dist/index.js)
npm run clean    # Remove dist/ directory
npm run lint     # Type check without emitting files
```

### Testing
Currently no automated tests - manual testing via MCP tool calls.

### Type System
Strict TypeScript with ES2022 target. All interfaces defined in `src/types.ts`.

## MCP Server Integration

The main entry point is `src/index.ts` - an MCP server using stdio transport. It routes tool calls to appropriate managers and coordinates manager synchronization when projects are activated.

### Tool Registration
Tools are registered in the `setupToolHandlers()` method. Each tool handler:
1. Validates parameters using TypeScript interfaces from `types.ts`
2. Delegates to the appropriate manager
3. Returns structured `ToolResponse` objects

### Manager Synchronization
When a project is activated, all managers (history, snapshot, projectSnapshot) must have their `updateCacheDirectory()` methods called with the project's `.CodeRecoder/` path. This happens in `initializeManagers()` on startup and when `activate_project` is called.

## Key Data Structures

### Project Configuration
Stored in `.CodeRecoder/config/project.json`:
```json
{
  "projectName": string,
  "projectRoot": string,
  "language"?: string,
  "activated": boolean,
  "createdAt": number,
  "lastUsed": number
}
```

### File Snapshots
Organized by session in `.CodeRecoder/snapshots/files/[sessionId]/` with a `sessions.json` index. Each snapshot is a direct file copy with metadata.

### Project Snapshots
Stored in `.CodeRecoder/snapshots/projects/[snapshotId]/` with an `index.json` manifest. Incremental snapshots reference a `baseSnapshotId` to form restoration chains.

### Edit History
Traditional edit tracking in `.CodeRecoder/history/edits.json` with tree-based parent-child relationships.

## Important Implementation Notes

1. **Path Safety**: All file operations use path.join() and validate paths to prevent directory traversal attacks. The `DataStructureManager` provides utility methods for safe path resolution.

2. **Async/Await**: All file system operations use async methods from `fs-extra`. Manager methods that perform I/O are async.

3. **Error Handling**: Managers return structured `ToolResponse` objects with `{success, message, data, error}` fields. The server logs errors and returns user-friendly messages.

4. **Global State**: `ProjectManager` maintains a global cache directory at `~/.coderecoder-global` and tracks the currently active project. Other managers are stateless until a project is activated.

5. **No Git Dependency**: While change detection can use Git status if available, the system works without Git by using file stat and content hashing.

6. **MCP Client Configuration**: To integrate with Claude Desktop or Cline, configure the MCP server to run `node /path/to/CodeRecoder/dist/index.js` with cwd set to the CodeRecoder directory.

## Performance Considerations

- File snapshots: < 50ms via direct copying
- Project snapshots: < 2s for 100+ file projects
- Change detection: < 500ms via four-way detection
- Incremental snapshots only store changed files
- Snapshot restoration verifies content integrity before overwriting

## AI Integration (Optional)

The `AIAnalysisService` integrates with Serena (`.serena/project.yml`) for code analysis. This is optional - the system works without Serena, but provides enhanced change summaries and complexity analysis when available.
