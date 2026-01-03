# CodeRecoder Test Suite

This directory contains comprehensive tests for the CodeRecoder MCP tool.

## Test Files

### 1. `quick_test.sh`
Quick verification test for core functionality (~10 seconds).

```bash
./test/quick_test.sh
```

Tests:
- Project activation
- File snapshot creation
- Project snapshot creation
- Snapshot listing
- Project deactivation

### 2. `test_full_workflow.sh`
Complete workflow test covering all major features (~30 seconds).

```bash
./test/test_full_workflow.sh
```

Tests:
- ✅ Project activation
- ✅ Full snapshot creation (#1)
- ✅ File modification detection
- ✅ Incremental snapshot creation (#2, #3)
- ✅ Snapshot listing with metadata
- ✅ File-level snapshots
- ✅ Snapshot restoration
- ✅ Session management
- ✅ Project deactivation

### 3. `test_mcp_tools.js`
Comprehensive Node.js test suite for all MCP tools.

```bash
node test/test_mcp_tools.js
```

Tests all 17 MCP tools:
- Project Management (activate, deactivate, list, info)
- Session Management (create, get current)
- File Snapshots (create, list, restore, delete)
- Project Snapshots (create, list, restore)
- Legacy Tools (record_edit, list_history, rollback, diff)

## Running All Tests

```bash
# Quick test
npm run test:quick

# Full workflow test
npm run test:workflow

# All tests
npm test
```

## Test Requirements

1. Node.js 18+
2. Built project (`npm run build`)
3. Write access to `/tmp` directory
4. rsync installed (for project snapshots)

## Test Output

Test results are saved to:
- `test/test_results.log` - Shell test logs
- `test/test_results.json` - Node.js test results

## Expected Results

All tests should pass with 100% success rate:

```
============================================
Results: 10 successful, 0 failed
============================================
✅ Overall: EXCELLENT (100% pass rate)
```

## Troubleshooting

If tests fail:

1. **Build project first**:
   ```bash
   npm run build
   ```

2. **Check Node.js version**:
   ```bash
   node --version  # Should be 18+
   ```

3. **Verify rsync**:
   ```bash
   which rsync
   ```

4. **Check permissions**:
   ```bash
   ls -la /tmp
   ```
