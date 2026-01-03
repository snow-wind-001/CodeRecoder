#!/bin/bash

# ============================================================
# CodeRecoder Quick Test - Simple verification of core functionality
# ============================================================

set -e

PROJECT_DIR="/home/spikebai/owncode/CodeRecoder"
TEST_DIR="/tmp/coderecoder_quick_test"

echo "🚀 CodeRecoder Quick Test"
echo "========================="

# Setup
echo "📋 Setting up test environment..."
rm -rf $TEST_DIR
mkdir -p $TEST_DIR

# Create valid project files
echo "// Test file" > $TEST_DIR/test.js
echo "const x = 1;" >> $TEST_DIR/test.js

# Create package.json to make it a valid project
cat > $TEST_DIR/package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0",
  "description": "Test project for CodeRecoder"
}
EOF

cd $PROJECT_DIR

# Run continuous MCP session
echo ""
echo "🔧 Running MCP tool tests..."
{
    # 1. Activate project
    echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"activate_project","arguments":{"projectPath":"'$TEST_DIR'"}}}'
    sleep 2
    
    # 2. Create file snapshot
    echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_file_snapshot","arguments":{"filePath":"'$TEST_DIR'/test.js","prompt":"Quick test snapshot"}}}'
    sleep 2
    
    # 3. Create project snapshot
    echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_project_snapshot","arguments":{"prompt":"Quick test project snapshot","name":"Quick Test"}}}'
    sleep 2
    
    # 4. List snapshots
    echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_project_snapshots","arguments":{}}}' 
    sleep 2
    
    # 5. Deactivate
    echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"deactivate_project","arguments":{"saveHistory":true}}}'
} | node dist/index.js 2>&1 | tee /tmp/quick_test_output.log

echo ""
echo "📊 Checking results..."

# Check for success by counting JSON responses
echo ""
echo "📊 Analyzing test results..."

# Count success responses
SUCCESSES=$(grep -o '"success": true' /tmp/quick_test_output.log | wc -l)
FAILURES=$(grep -o '"success": false' /tmp/quick_test_output.log | wc -l)

# Also check for escaped JSON format
SUCCESSES_ESCAPED=$(grep -o '\\"success\\": true' /tmp/quick_test_output.log | wc -l || true)
FAILURES_ESCAPED=$(grep -o '\\"success\\": false' /tmp/quick_test_output.log | wc -l || true)

TOTAL_SUCCESS=$((SUCCESSES + SUCCESSES_ESCAPED))
TOTAL_FAIL=$((FAILURES + FAILURES_ESCAPED))

echo ""
echo "============================================"
echo "Results: $TOTAL_SUCCESS successful, $TOTAL_FAIL failed"
echo "============================================"

if [ "$TOTAL_SUCCESS" -ge 4 ]; then
    echo "✅ Quick test PASSED"
    EXIT_CODE=0
else
    echo "⚠️ Running detailed check..."
    # Last resort - check for specific success markers
    if grep -q "Project activated successfully" /tmp/quick_test_output.log && \
       grep -q "AI-enhanced snapshot created" /tmp/quick_test_output.log && \
       grep -q "项目快照创建成功" /tmp/quick_test_output.log; then
        echo "✅ Quick test PASSED (marker verification)"
        EXIT_CODE=0
    else
        echo "❌ Quick test FAILED"
        EXIT_CODE=1
    fi
fi

# Cleanup
rm -rf $TEST_DIR
rm -f /tmp/quick_test_output.log

exit $EXIT_CODE
