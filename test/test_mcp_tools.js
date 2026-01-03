/**
 * CodeRecoder MCP Tool Comprehensive Test Suite
 * 
 * This script tests all MCP tools through the JSON-RPC interface
 * Run with: node test/test_mcp_tools.js
 */

import { spawn } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_PROJECT_DIR = '/tmp/coderecoder_mcp_test';
const MCP_SERVER_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

/**
 * Run MCP commands in a single session
 */
async function runMCPSession(commands) {
  return new Promise((resolve, reject) => {
    const mcp = spawn('node', [MCP_SERVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    mcp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    mcp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    mcp.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });

    mcp.on('error', (err) => {
      reject(err);
    });

    // Send commands with delays
    let delay = 0;
    commands.forEach((cmd, index) => {
      setTimeout(() => {
        const jsonCmd = JSON.stringify({
          jsonrpc: '2.0',
          id: index + 1,
          method: 'tools/call',
          params: {
            name: cmd.tool,
            arguments: cmd.args
          }
        });
        mcp.stdin.write(jsonCmd + '\n');
      }, delay);
      delay += 500; // 500ms between commands
    });

    // Close stdin after all commands
    setTimeout(() => {
      mcp.stdin.end();
    }, delay + 1000);

    // Timeout after 30 seconds
    setTimeout(() => {
      mcp.kill();
      reject(new Error('MCP session timeout'));
    }, 30000);
  });
}

/**
 * Parse MCP response to get result for specific ID
 */
function parseResponse(stdout, id) {
  const lines = stdout.split('\n');
  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.id === id && json.result) {
        return json.result;
      }
    } catch (e) {
      // Not a JSON line, skip
    }
  }
  return null;
}

/**
 * Record test result
 */
function recordTest(name, passed, details = '') {
  results.tests.push({ name, passed, details });
  if (passed) {
    results.passed++;
    log(colors.green, `  ✅ PASS: ${name}`);
  } else {
    results.failed++;
    log(colors.red, `  ❌ FAIL: ${name}`);
    if (details) {
      log(colors.red, `     ${details}`);
    }
  }
}

/**
 * Setup test environment
 */
async function setupTestEnvironment() {
  log(colors.blue, '\n📋 Setting up test environment...');
  
  // Clean and create test project directory
  await fs.remove(TEST_PROJECT_DIR);
  await fs.ensureDir(TEST_PROJECT_DIR);
  await fs.ensureDir(path.join(TEST_PROJECT_DIR, 'src'));
  
  // Create test files
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'test_file.js'),
    `// Test file for CodeRecoder
function hello() {
  console.log('Hello, World!');
}

function add(a, b) {
  return a + b;
}

module.exports = { hello, add };
`
  );
  
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'src', 'main.js'),
    `// Main source file
const utils = require('./utils');

function main() {
  console.log('Starting application...');
  utils.initialize();
}

main();
`
  );
  
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'src', 'utils.js'),
    `// Utility functions
function initialize() {
  console.log('Initializing...');
}

function cleanup() {
  console.log('Cleaning up...');
}

module.exports = { initialize, cleanup };
`
  );
  
  await fs.writeFile(
    path.join(TEST_PROJECT_DIR, 'package.json'),
    JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      description: 'Test project for CodeRecoder'
    }, null, 2)
  );
  
  log(colors.green, '✅ Test environment ready\n');
}

/**
 * Test Project Management Tools
 */
async function testProjectManagement() {
  log(colors.yellow, '🔧 Testing Project Management Tools...');
  
  // Test activate_project
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } }
    ]);
    const result = parseResponse(response.stdout, 1);
    const success = result?.content?.[0]?.text?.includes('"success":true') || 
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('activate_project', success, success ? '' : 'Failed to activate project');
  } catch (e) {
    recordTest('activate_project', false, e.message);
  }
  
  // Test get_project_info
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'get_project_info', args: {} }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('get_project_info', success);
  } catch (e) {
    recordTest('get_project_info', false, e.message);
  }
  
  // Test list_projects
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'list_projects', args: {} }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('list_projects', success);
  } catch (e) {
    recordTest('list_projects', false, e.message);
  }
}

/**
 * Test Session Management Tools
 */
async function testSessionManagement() {
  log(colors.yellow, '\n🔧 Testing Session Management Tools...');
  
  // Test create_session
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'create_session', args: { name: 'Test Session', description: 'Automated test session' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('create_session', success);
  } catch (e) {
    recordTest('create_session', false, e.message);
  }
  
  // Test get_current_session
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'create_session', args: { name: 'Test Session' } },
      { tool: 'get_current_session', args: {} }
    ]);
    const result = parseResponse(response.stdout, 3);
    const success = result?.content?.[0]?.text?.includes('session') ||
                   result?.content?.[0]?.text?.includes('Session');
    recordTest('get_current_session', success);
  } catch (e) {
    recordTest('get_current_session', false, e.message);
  }
}

/**
 * Test File Snapshot Tools
 */
async function testFileSnapshots() {
  log(colors.yellow, '\n🔧 Testing File Snapshot Tools...');
  
  const testFile = path.join(TEST_PROJECT_DIR, 'test_file.js');
  
  // Test create_file_snapshot
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'create_file_snapshot', args: { 
        filePath: testFile, 
        prompt: 'Initial test snapshot' 
      }}
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('create_file_snapshot', success);
  } catch (e) {
    recordTest('create_file_snapshot', false, e.message);
  }
  
  // Test list_file_snapshots
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'create_file_snapshot', args: { filePath: testFile, prompt: 'Test' } },
      { tool: 'list_file_snapshots', args: {} }
    ]);
    const result = parseResponse(response.stdout, 3);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('list_file_snapshots', success);
  } catch (e) {
    recordTest('list_file_snapshots', false, e.message);
  }
  
  // Test restore_file_snapshot capability
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'restore_file_snapshot', args: { snapshotId: 'test-id' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    // Even with invalid ID, API should respond properly
    const hasResponse = result?.content?.[0]?.text !== undefined;
    recordTest('restore_file_snapshot (API check)', hasResponse);
  } catch (e) {
    recordTest('restore_file_snapshot (API check)', false, e.message);
  }
  
  // Test delete_file_snapshot capability
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'delete_file_snapshot', args: { snapshotId: 'nonexistent-id' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const hasResponse = result?.content?.[0]?.text !== undefined;
    recordTest('delete_file_snapshot (API check)', hasResponse);
  } catch (e) {
    recordTest('delete_file_snapshot (API check)', false, e.message);
  }
}

/**
 * Test Project Snapshot Tools
 */
async function testProjectSnapshots() {
  log(colors.yellow, '\n🔧 Testing Project Snapshot Tools...');
  
  // Test create_project_snapshot
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'create_project_snapshot', args: { 
        prompt: 'Test project snapshot',
        name: 'Test Snapshot',
        tags: ['test', 'automated']
      }}
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('create_project_snapshot', success);
  } catch (e) {
    recordTest('create_project_snapshot', false, e.message);
  }
  
  // Test list_project_snapshots
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'list_project_snapshots', args: {} }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('list_project_snapshots', success);
  } catch (e) {
    recordTest('list_project_snapshots', false, e.message);
  }
  
  // Test restore_project_snapshot capability
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'restore_project_snapshot', args: { snapshotId: 'test-id' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const hasResponse = result?.content?.[0]?.text !== undefined;
    recordTest('restore_project_snapshot (API check)', hasResponse);
  } catch (e) {
    recordTest('restore_project_snapshot (API check)', false, e.message);
  }
}

/**
 * Test Legacy Tools
 */
async function testLegacyTools() {
  log(colors.yellow, '\n🔧 Testing Legacy Tools...');
  
  const testFile = path.join(TEST_PROJECT_DIR, 'test_file.js');
  
  // Test record_edit
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'record_edit', args: { 
        filePath: testFile,
        startLine: 1,
        endLine: 2,
        oldContent: '// Test',
        newContent: '// Modified',
        prompt: 'Test edit'
      }}
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('record_edit (legacy)', success);
  } catch (e) {
    recordTest('record_edit (legacy)', false, e.message);
  }
  
  // Test list_history
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'list_history', args: {} }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('list_history (legacy)', success);
  } catch (e) {
    recordTest('list_history (legacy)', false, e.message);
  }
  
  // Test rollback_to_version capability
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'rollback_to_version', args: { sessionId: 'test-session' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const hasResponse = result?.content?.[0]?.text !== undefined;
    recordTest('rollback_to_version (API check)', hasResponse);
  } catch (e) {
    recordTest('rollback_to_version (API check)', false, e.message);
  }
  
  // Test get_diff capability
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'get_diff', args: { fromEditId: 'id1', toEditId: 'id2' } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const hasResponse = result?.content?.[0]?.text !== undefined;
    recordTest('get_diff (API check)', hasResponse);
  } catch (e) {
    recordTest('get_diff (API check)', false, e.message);
  }
}

/**
 * Test Utility Tools
 */
async function testUtilityTools() {
  log(colors.yellow, '\n🔧 Testing Utility Tools...');
  
  // Test deactivate_project
  try {
    const response = await runMCPSession([
      { tool: 'activate_project', args: { projectPath: TEST_PROJECT_DIR } },
      { tool: 'deactivate_project', args: { saveHistory: true } }
    ]);
    const result = parseResponse(response.stdout, 2);
    const success = result?.content?.[0]?.text?.includes('"success":true') ||
                   result?.content?.[0]?.text?.includes('"success": true');
    recordTest('deactivate_project', success);
  } catch (e) {
    recordTest('deactivate_project', false, e.message);
  }
}

/**
 * Print test summary
 */
function printSummary() {
  const total = results.passed + results.failed;
  const passRate = Math.round((results.passed / total) * 100);
  
  log(colors.blue, '\n============================================================');
  log(colors.blue, '   Test Summary');
  log(colors.blue, '============================================================\n');
  
  console.log(`Total Tests: ${total}`);
  log(colors.green, `Passed: ${results.passed}`);
  log(colors.red, `Failed: ${results.failed}`);
  console.log(`Pass Rate: ${passRate}%\n`);
  
  if (passRate >= 90) {
    log(colors.green, `✅ Overall: EXCELLENT (${passRate}% pass rate)`);
  } else if (passRate >= 70) {
    log(colors.yellow, `⚠️ Overall: GOOD (${passRate}% pass rate)`);
  } else {
    log(colors.red, `❌ Overall: NEEDS IMPROVEMENT (${passRate}% pass rate)`);
  }
  
  // Save results to file
  const resultsPath = path.join(__dirname, 'test_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  log(colors.blue, `\n📝 Results saved to: ${resultsPath}`);
}

/**
 * Cleanup test environment
 */
async function cleanup() {
  log(colors.yellow, '\n🧹 Cleaning up test environment...');
  await fs.remove(TEST_PROJECT_DIR);
  log(colors.green, '✅ Cleanup complete');
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n');
  log(colors.cyan, '============================================================');
  log(colors.cyan, '   CodeRecoder MCP Tool Comprehensive Test Suite');
  log(colors.cyan, '============================================================');
  
  try {
    await setupTestEnvironment();
    
    await testProjectManagement();
    await testSessionManagement();
    await testFileSnapshots();
    await testProjectSnapshots();
    await testLegacyTools();
    await testUtilityTools();
    
    printSummary();
    await cleanup();
    
  } catch (error) {
    log(colors.red, `\n❌ Test suite failed: ${error.message}`);
    console.error(error);
    await cleanup();
    process.exit(1);
  }
  
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
