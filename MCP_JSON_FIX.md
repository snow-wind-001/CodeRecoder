# MCP JSON输出修复报告

## 🐛 问题描述

MCP客户端日志显示JSON解析错误：
```
Client error for command Unexpected token '', "📂 恢复当前项目:"... is not valid JSON
Client error for command Unexpected token '', "📊 加载文件快照: 0个快照" is not valid JSON
```

## 🔍 根本原因

MCP协议要求：
- **stdout**: 只能用于JSON-RPC通信，必须输出纯JSON
- **stderr**: 用于日志输出，可以包含任何文本

代码中大量使用 `console.log()` 输出到stdout，破坏了JSON-RPC协议。

## ✅ 修复方案

将所有 `console.log()` 改为 `console.error()`，确保：
- ✅ 所有日志输出到stderr
- ✅ stdout只包含JSON-RPC响应
- ✅ 符合MCP协议规范

## 📝 修复的文件

1. **src/index.ts** - 主MCP服务器文件
2. **src/projectManager.ts** - 项目管理器
3. **src/fileSnapshotManager.ts** - 文件快照管理器
4. **src/projectSnapshotManager.ts** - 项目快照管理器

## 🧪 测试验证

运行测试脚本验证修复：
```bash
node test_mcp_json_fix.js
```

**测试结果：** ✅ 通过
- stdout只包含JSON-RPC响应
- 所有日志正确输出到stderr
- 无JSON解析错误

## 📊 修复统计

- **修复的console.log数量**: 28+ 处
- **影响文件**: 4个核心文件
- **修复时间**: 2025-01-04

## 🎯 最佳实践

### ✅ 正确做法

```typescript
// 日志输出到stderr
console.error('📊 加载项目数据...');

// JSON-RPC响应输出到stdout（自动处理）
return { success: true, data: {...} };
```

### ❌ 错误做法

```typescript
// 不要使用console.log（会输出到stdout）
console.log('📊 加载项目数据...'); // ❌ 破坏JSON-RPC协议
```

## 🔄 后续维护

在添加新代码时，请遵循：
1. **日志输出**: 始终使用 `console.error()`
2. **调试信息**: 使用 `console.error()` 或 `console.warn()`
3. **JSON响应**: 通过MCP SDK自动处理，无需手动输出

## 📚 相关文档

- [MCP协议规范](https://modelcontextprotocol.io/)
- [CodeRecoder MCP配置指南](./MCP_CONFIG_GUIDE.md)

---

**修复完成时间**: 2025-01-04  
**验证状态**: ✅ 已通过测试