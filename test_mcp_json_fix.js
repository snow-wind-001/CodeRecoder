#!/usr/bin/env node

/**
 * 测试MCP服务器JSON输出修复
 * 验证所有输出都正确发送到stderr，stdout只包含JSON-RPC响应
 */

import { spawn } from 'child_process';

const mcpServer = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: '/home/spikebai/owncode/CodeRecoder'
});

let stdout = '';
let stderr = '';
let hasJsonError = false;

mcpServer.stdout.on('data', (data) => {
  const text = data.toString();
  stdout += text;
  
  // 检查是否有非JSON内容
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.trim() && !line.trim().startsWith('{') && !line.trim().startsWith('[')) {
      console.error(`❌ 发现stdout中的非JSON内容: ${line}`);
      hasJsonError = true;
    }
  }
});

mcpServer.stderr.on('data', (data) => {
  stderr += data.toString();
});

mcpServer.on('close', (code) => {
  console.log('\n📊 测试结果:');
  console.log('='.repeat(60));
  
  if (hasJsonError) {
    console.error('❌ 测试失败: stdout包含非JSON内容');
    console.error('\n📋 stdout内容:');
    console.error(stdout);
  } else {
    console.log('✅ 测试通过: stdout只包含JSON-RPC响应');
  }
  
  console.log('\n📋 stderr内容（日志）:');
  console.log(stderr.substring(0, 500)); // 只显示前500字符
  
  process.exit(hasJsonError ? 1 : 0);
});

// 发送一个简单的MCP请求
setTimeout(() => {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  };
  
  mcpServer.stdin.write(JSON.stringify(request) + '\n');
  
  // 3秒后关闭
  setTimeout(() => {
    mcpServer.kill();
  }, 3000);
}, 500);