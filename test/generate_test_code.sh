#!/bin/bash

# ============================================================
# Generate Test Code Files for CodeRecoder Testing
# Creates a sample project with multiple file types
# ============================================================

TEST_DIR="${1:-/tmp/coderecoder_sample_project}"

echo "🔧 Generating test code files in: $TEST_DIR"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"/{src,lib,config}

# package.json
cat > "$TEST_DIR/package.json" << 'EOF'
{
  "name": "sample-test-project",
  "version": "1.0.0",
  "description": "Sample project for testing CodeRecoder",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node src/test.js"
  },
  "author": "Test User",
  "license": "MIT"
}
EOF

# Main entry point
cat > "$TEST_DIR/src/index.js" << 'EOF'
/**
 * Main Application Entry Point
 * @module main
 */

const utils = require('./utils');
const config = require('../config/settings');

class Application {
  constructor() {
    this.name = config.appName;
    this.version = config.version;
    this.initialized = false;
  }

  async initialize() {
    console.log(`Initializing ${this.name} v${this.version}...`);
    await utils.delay(100);
    this.initialized = true;
    return this;
  }

  run() {
    if (!this.initialized) {
      throw new Error('Application not initialized');
    }
    console.log('Application running...');
    return this;
  }

  shutdown() {
    console.log('Shutting down...');
    this.initialized = false;
  }
}

// Main execution
async function main() {
  const app = new Application();
  await app.initialize();
  app.run();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    app.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);

module.exports = { Application };
EOF

# Utils module
cat > "$TEST_DIR/src/utils.js" << 'EOF'
/**
 * Utility Functions
 * @module utils
 */

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deep clone an object
 * @param {object} obj - Object to clone
 * @returns {object} Cloned object
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a random ID
 * @param {number} length - ID length
 * @returns {string} Random ID
 */
function generateId(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes count
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  delay,
  deepClone,
  generateId,
  formatBytes
};
EOF

# Library module
cat > "$TEST_DIR/lib/dataProcessor.js" << 'EOF'
/**
 * Data Processing Library
 * @module dataProcessor
 */

class DataProcessor {
  constructor(options = {}) {
    this.batchSize = options.batchSize || 100;
    this.workers = options.workers || 4;
    this.processed = 0;
  }

  /**
   * Process array of items
   * @param {Array} items - Items to process
   * @returns {Array} Processed items
   */
  process(items) {
    const results = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      results.push(...this.processBatch(batch));
    }
    this.processed += items.length;
    return results;
  }

  processBatch(batch) {
    return batch.map(item => ({
      ...item,
      processed: true,
      timestamp: Date.now()
    }));
  }

  getStats() {
    return {
      processed: this.processed,
      batchSize: this.batchSize,
      workers: this.workers
    };
  }
}

module.exports = { DataProcessor };
EOF

# Config file
cat > "$TEST_DIR/config/settings.js" << 'EOF'
/**
 * Application Configuration
 * @module config
 */

module.exports = {
  appName: 'SampleApp',
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  
  server: {
    host: 'localhost',
    port: 3000,
    timeout: 30000
  },
  
  database: {
    host: 'localhost',
    port: 5432,
    name: 'sample_db'
  },
  
  logging: {
    level: 'info',
    format: 'json',
    output: 'stdout'
  }
};
EOF

# Test file
cat > "$TEST_DIR/src/test.js" << 'EOF'
/**
 * Simple Test Suite
 */

const { Application } = require('./index');
const utils = require('./utils');

async function runTests() {
  console.log('Running tests...\n');
  
  // Test 1: Utils delay
  const start = Date.now();
  await utils.delay(50);
  const elapsed = Date.now() - start;
  console.log(`✅ delay() works (${elapsed}ms)`);
  
  // Test 2: Utils generateId
  const id = utils.generateId(12);
  console.log(`✅ generateId() = ${id}`);
  
  // Test 3: Utils formatBytes
  const formatted = utils.formatBytes(1024 * 1024);
  console.log(`✅ formatBytes(1MB) = ${formatted}`);
  
  // Test 4: Deep clone
  const obj = { a: 1, b: { c: 2 } };
  const cloned = utils.deepClone(obj);
  console.log(`✅ deepClone() works`);
  
  console.log('\n✅ All tests passed!');
}

runTests().catch(console.error);
EOF

# README
cat > "$TEST_DIR/README.md" << 'EOF'
# Sample Test Project

A sample project for testing CodeRecoder functionality.

## Structure

```
├── src/
│   ├── index.js    # Main entry point
│   ├── utils.js    # Utility functions
│   └── test.js     # Test suite
├── lib/
│   └── dataProcessor.js  # Data processing library
├── config/
│   └── settings.js       # Configuration
└── package.json
```

## Usage

```bash
npm start    # Run application
npm test     # Run tests
```
EOF

echo "✅ Test code files generated successfully!"
echo ""
echo "Files created:"
find "$TEST_DIR" -type f | sort

echo ""
echo "📊 Line counts:"
find "$TEST_DIR" -name "*.js" -exec wc -l {} + | tail -1
