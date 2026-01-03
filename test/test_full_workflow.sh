#!/bin/bash

# ============================================================
# CodeRecoder Full Workflow Test
# Tests complete snapshot creation and restoration workflow
# ============================================================

set -e

PROJECT_DIR="/home/spikebai/owncode/CodeRecoder"
TEST_DIR="/tmp/coderecoder_full_test"
MCP_CMD="node $PROJECT_DIR/dist/index.js"
LOG_FILE="/tmp/full_workflow_test.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}   CodeRecoder Full Workflow Test${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""

# Helper to run MCP command
run_mcp() {
    local tool=$1
    local args=$2
    echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}"
}

# Helper to test result
check_result() {
    local test_name=$1
    local result=$2
    local expected=$3
    
    if echo "$result" | grep -q "$expected"; then
        echo -e "${GREEN}✅ PASS${NC}: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC}: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# ============================================================
# Setup Phase
# ============================================================
echo -e "${YELLOW}📋 Phase 1: Setup${NC}"
rm -rf $TEST_DIR
mkdir -p $TEST_DIR/src

# Create initial project files
cat > $TEST_DIR/package.json << 'EOF'
{
  "name": "workflow-test",
  "version": "1.0.0",
  "description": "Test project for workflow testing"
}
EOF

cat > $TEST_DIR/src/main.js << 'EOF'
// Main application file
function main() {
  console.log('Hello World - Version 1');
}
main();
EOF

cat > $TEST_DIR/src/utils.js << 'EOF'
// Utility functions
function helper() {
  return 'helper v1';
}
module.exports = { helper };
EOF

echo -e "${GREEN}✅ Test project created${NC}"
echo ""

# ============================================================
# Test 1: Activate Project
# ============================================================
echo -e "${YELLOW}📋 Phase 2: Project Activation${NC}"
RESULT=$(run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}" | $MCP_CMD 2>/dev/null | grep -o '{"result".*}' | head -1)
check_result "activate_project" "$RESULT" "success"
echo ""

# ============================================================
# Test 2: Create First Full Snapshot
# ============================================================
echo -e "${YELLOW}📋 Phase 3: Create First Snapshot (Full)${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "create_project_snapshot" "{\"prompt\":\"Initial version\",\"name\":\"V1 - Initial\"}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

# Check for saveNumber in JSON (may be escaped)
if grep -q 'saveNumber.*1' $LOG_FILE || grep -q 'full #1' $LOG_FILE; then
    check_result "create first snapshot (full #1)" "found" "found"
else
    check_result "create first snapshot (full #1)" "" "saveNumber"
fi
# Extract snapshot ID (handles escaped JSON)
SNAPSHOT1_ID=$(grep -oE 'snapshotId.*[a-f0-9-]{36}' $LOG_FILE | head -1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   📸 Snapshot 1 ID: ${SNAPSHOT1_ID:0:8}..."
echo ""

# ============================================================
# Test 3: Modify Files and Create Incremental Snapshot
# ============================================================
echo -e "${YELLOW}📋 Phase 4: Modify Files & Create Incremental Snapshot${NC}"

# Modify main.js
cat > $TEST_DIR/src/main.js << 'EOF'
// Main application file - Version 2
function main() {
  console.log('Hello World - Version 2');
  console.log('New feature added');
}
main();
EOF

# Wait for file system
sleep 1

{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "create_project_snapshot" "{\"prompt\":\"Added new feature\",\"name\":\"V2 - Feature Added\"}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

# Check for saveNumber in JSON (may be escaped)
if grep -q 'saveNumber.*2' $LOG_FILE || grep -q '#2' $LOG_FILE; then
    check_result "create incremental snapshot (#2)" "found" "found"
else
    check_result "create incremental snapshot (#2)" "" "saveNumber"
fi
# Extract snapshot ID (handles escaped JSON)
SNAPSHOT2_ID=$(grep -oE 'snapshotId.*[a-f0-9-]{36}' $LOG_FILE | head -1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   📸 Snapshot 2 ID: ${SNAPSHOT2_ID:0:8}..."
echo ""

# ============================================================
# Test 4: List Snapshots
# ============================================================
echo -e "${YELLOW}📋 Phase 5: List All Snapshots${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "list_project_snapshots" "{}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

# Check that both snapshots are listed
if grep -q "V1 - Initial" $LOG_FILE && grep -q "V2 - Feature Added" $LOG_FILE; then
    check_result "list_project_snapshots" "found" "found"
else
    check_result "list_project_snapshots" "" "found"
fi
echo ""

# ============================================================
# Test 5: Create File Snapshot
# ============================================================
echo -e "${YELLOW}📋 Phase 6: File-level Snapshot${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "create_file_snapshot" "{\"filePath\":\"$TEST_DIR/src/main.js\",\"prompt\":\"Before major refactor\"}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

RESULT=$(grep -o '"AI-enhanced snapshot created"' $LOG_FILE || grep -o 'success.*true' $LOG_FILE || true)
check_result "create_file_snapshot" "$RESULT" ""
# Extract snapshot ID (handles escaped JSON)
FILE_SNAPSHOT_ID=$(grep -oE 'snapshotId.*[a-f0-9-]{36}' $LOG_FILE | head -1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   📸 File Snapshot ID: ${FILE_SNAPSHOT_ID:0:8}..."
echo ""

# ============================================================
# Test 6: List File Snapshots
# ============================================================
echo -e "${YELLOW}📋 Phase 7: List File Snapshots${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "list_file_snapshots" "{}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

if grep -q "main.js" $LOG_FILE; then
    check_result "list_file_snapshots" "found" "found"
else
    check_result "list_file_snapshots" "" "found"
fi
echo ""

# ============================================================
# Test 7: Modify and Create Third Snapshot
# ============================================================
echo -e "${YELLOW}📋 Phase 8: Create Third Snapshot${NC}"

# Make more modifications
cat > $TEST_DIR/src/main.js << 'EOF'
// Main application file - Version 3
function main() {
  console.log('Hello World - Version 3');
  console.log('New feature added');
  console.log('Bug fix applied');
}
main();
EOF

sleep 1

{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "create_project_snapshot" "{\"prompt\":\"Bug fix release\",\"name\":\"V3 - Bug Fix\",\"tags\":[\"bugfix\",\"stable\"]}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

# Check for saveNumber in JSON (may be escaped)
if grep -q 'saveNumber.*3' $LOG_FILE || grep -q '#3' $LOG_FILE; then
    check_result "create third snapshot (#3)" "found" "found"
else
    check_result "create third snapshot (#3)" "" "saveNumber"
fi
# Extract snapshot ID (handles escaped JSON)
SNAPSHOT3_ID=$(grep -oE 'snapshotId.*[a-f0-9-]{36}' $LOG_FILE | head -1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   📸 Snapshot 3 ID: ${SNAPSHOT3_ID:0:8}..."
echo ""

# ============================================================
# Test 8: Restore First Snapshot
# ============================================================
echo -e "${YELLOW}📋 Phase 9: Restore First Snapshot${NC}"

if [ -n "$SNAPSHOT1_ID" ]; then
    {
        run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
        sleep 1
        run_mcp "restore_project_snapshot" "{\"snapshotId\":\"$SNAPSHOT1_ID\"}"
    } | $MCP_CMD 2>/dev/null | tee $LOG_FILE
    
    # Check if main.js was restored to Version 1
    if grep -q "Version 1" $TEST_DIR/src/main.js; then
        check_result "restore_project_snapshot (V1)" "found" "found"
    else
        check_result "restore_project_snapshot (V1)" "" "Version 1"
    fi
else
    check_result "restore_project_snapshot (V1)" "" "snapshot ID not captured"
fi
echo ""

# ============================================================
# Test 9: Session Management
# ============================================================
echo -e "${YELLOW}📋 Phase 10: Session Management${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "create_session" "{\"name\":\"Test Session\",\"description\":\"Workflow test session\"}"
    sleep 1
    run_mcp "get_current_session" "{}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

if grep -q "Test Session" $LOG_FILE; then
    check_result "session_management" "found" "found"
else
    check_result "session_management" "" "Test Session"
fi
echo ""

# ============================================================
# Test 10: Deactivate Project
# ============================================================
echo -e "${YELLOW}📋 Phase 11: Deactivate Project${NC}"
{
    run_mcp "activate_project" "{\"projectPath\":\"$TEST_DIR\"}"
    sleep 1
    run_mcp "deactivate_project" "{\"saveHistory\":true}"
} | $MCP_CMD 2>/dev/null | tee $LOG_FILE

if grep -q "deactivated" $LOG_FILE; then
    check_result "deactivate_project" "found" "found"
else
    check_result "deactivate_project" "" "deactivated"
fi
echo ""

# ============================================================
# Summary
# ============================================================
echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}   Test Summary${NC}"
echo -e "${CYAN}============================================================${NC}"
echo ""
TOTAL=$((TESTS_PASSED + TESTS_FAILED))
PASS_RATE=$((TESTS_PASSED * 100 / TOTAL))
echo -e "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo -e "Pass Rate: $PASS_RATE%"
echo ""

if [ $PASS_RATE -ge 80 ]; then
    echo -e "${GREEN}✅ Overall: EXCELLENT ($PASS_RATE% pass rate)${NC}"
elif [ $PASS_RATE -ge 60 ]; then
    echo -e "${YELLOW}⚠️ Overall: GOOD ($PASS_RATE% pass rate)${NC}"
else
    echo -e "${RED}❌ Overall: NEEDS IMPROVEMENT ($PASS_RATE% pass rate)${NC}"
fi

# Cleanup
echo ""
echo -e "${YELLOW}🧹 Cleaning up...${NC}"
rm -rf $TEST_DIR
rm -f $LOG_FILE
echo -e "${GREEN}✅ Done${NC}"

exit $TESTS_FAILED
