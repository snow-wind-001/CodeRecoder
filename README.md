# CodeRecoder MCP

<div align="center">

![CodeRecoder Logo](https://img.shields.io/badge/CodeRecoder-AI%20Code%20Versioning-blue?style=for-the-badge&logo=git&logoColor=white)

**智能代码版本管理系统 - 基于MCP协议的AI增强代码快照与恢复工具**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-green)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

## 🌟 项目简介

CodeRecoder是一个基于**Model Context Protocol (MCP)**的智能代码版本管理系统，专为AI辅助编程设计。它提供了类似Cursor编辑器的多轮生成和撤销功能，支持瞬间文件快照、项目级版本控制、智能变更检测和AI增强的代码分析。

### ✨ 核心特性

- 🚀 **瞬间快照** - 基于直接文件复制的高性能快照系统
- 🧠 **AI增强分析** - 集成Serena代码分析，智能识别代码变更和复杂度
- 📦 **项目级版本控制** - 类似Cursor的增量/全量快照策略
- 🔍 **智能变更检测** - 四重检测机制：Git状态、文件统计、内容哈希、时间戳
- 🏷️ **快照标签系统** - 用户友好的快照命名和分类
- 🔗 **智能链式恢复** - 增量快照依赖关系自动处理
- 📊 **结构化数据管理** - 项目独立的`.CodeRecoder`目录结构
- 🛡️ **安全恢复机制** - 验证快照内容，防止意外数据丢失

## 🛠 技术架构

### 系统组件

```
CodeRecoder MCP Server
├── 📁 Core Managers
│   ├── ProjectManager        # 项目激活与配置管理
│   ├── FileSnapshotManager   # 单文件快照管理
│   ├── ProjectSnapshotManager# 项目级快照管理
│   └── HistoryManager        # 传统编辑历史管理
├── 🔍 Analysis Services
│   └── AIAnalysisService     # AI代码分析集成
├── 📊 Data Structure
│   └── DataStructureManager  # 结构化数据管理
└── 🌐 MCP Interface
    └── CodeRecoderServer     # MCP协议服务器
```

### 数据存储结构

每个项目在其根目录下维护独立的`.CodeRecoder`目录：

```
.CodeRecoder/
├── config/                   # 项目配置
│   ├── project.json         # 项目元信息
│   ├── settings.json        # 用户设置
│   └── cache.json          # 缓存配置
├── snapshots/               # 快照存储
│   ├── files/              # 文件快照
│   │   ├── [sessionId]/    # 会话分组
│   │   └── sessions.json   # 会话索引
│   ├── projects/           # 项目快照
│   │   ├── [snapshotId]/   # 完整项目副本
│   │   └── index.json      # 快照索引
│   └── snapshots.json      # 文件快照数据
├── history/                # 编辑历史
│   ├── edits.json         # 编辑记录
│   └── sessions.json      # 会话历史
├── analysis/              # AI分析缓存
│   ├── ai_summaries.json  # AI分析结果
│   └── code_metrics.json # 代码指标
└── logs/                  # 系统日志
    ├── debug.log         # 调试日志
    └── error.log         # 错误日志
```

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **TypeScript** >= 5.3.0
- **Git** (用于变更检测)
- **MCP兼容的AI助手** (如Claude Desktop、Cline等)

### 安装步骤

1. **克隆仓库**
```bash
git clone https://github.com/yourusername/CodeRecoder.git
cd CodeRecoder
```

2. **安装依赖**
```bash
npm install
```

3. **构建项目**
```bash
npm run build
```

4. **配置MCP客户端**

在Claude Desktop配置文件中添加：
```json
{
  "mcpServers": {
    "coderecoder": {
      "command": "node",
      "args": ["/path/to/CodeRecoder/dist/index.js"],
      "cwd": "/path/to/CodeRecoder"
    }
  }
}
```

5. **启动服务**
```bash
npm start
```

### 快速测试

```bash
# 激活项目
activate_project {"projectPath": "/path/to/your/project"}

# 创建文件快照
create_file_snapshot {
  "filePath": "/path/to/file.js",
  "prompt": "添加新功能前的备份"
}

# 创建项目快照
create_project_snapshot {
  "prompt": "功能开发完成",
  "name": "Feature v1.0",
  "tags": ["stable", "feature"]
}

# 列出快照
list_project_snapshots {}

# 恢复快照
restore_project_snapshot {"snapshotId": "your-snapshot-id"}
```

## 📖 MCP工具API

### 项目管理

#### `activate_project`
激活项目进行代码跟踪，创建结构化的`.CodeRecoder`目录。

```typescript
{
  "projectPath": string,     // 项目根目录路径
  "projectName"?: string,    // 可选项目名称
  "language"?: string        // 可选编程语言
}
```

#### `deactivate_project`
停用当前项目并可选择性保存历史记录。

#### `list_projects`
列出所有可用项目和当前激活的项目。

#### `get_project_info`
获取项目的详细信息。

### 文件快照管理

#### `create_file_snapshot`
为单个文件创建瞬间快照，支持AI分析。

```typescript
{
  "filePath": string,        // 文件路径
  "prompt": string,          // 快照描述
  "sessionId"?: string,      // 可选会话ID
  "metadata"?: object        // 可选元数据
}
```

#### `restore_file_snapshot`
从快照恢复文件，支持即时恢复。

```typescript
{
  "snapshotId": string       // 快照ID
}
```

#### `list_file_snapshots`
列出带有AI分析摘要的文件快照。

#### `delete_file_snapshot`
删除特定文件快照（不可撤销）。

### 项目快照管理

#### `create_project_snapshot`
创建项目级快照，类似Cursor的工作方式。

```typescript
{
  "prompt": string,          // 快照描述
  "name"?: string,          // 用户友好名称
  "tags"?: string[],        // 快照标签
  "projectPath"?: string    // 可选项目路径
}
```

**特性：**
- 🔍 智能变更检测（四重检测机制）
- 📦 增量/全量快照策略
- 🧠 Serena代码分析集成
- 🏷️ 标签分类系统

#### `list_project_snapshots`
列出所有项目快照，包含详细信息：

**输出信息：**
- 📅 快照时间和时间差
- 🏷️ 快照名称和标签
- 🤖 AI分析摘要
- 📁 实际文件数量
- 🔗 依赖快照关系
- 📏 快照大小信息

#### `restore_project_snapshot`
智能恢复项目快照，支持增量快照链式恢复。

```typescript
{
  "snapshotId": string       // 快照ID
}
```

**特性：**
- 🔗 自动构建恢复链
- 🛡️ 安全验证机制
- 📊 详细恢复进度

### 传统版本控制

#### `record_edit`
记录代码编辑（传统方式，建议使用快照）。

#### `rollback_to_version`
回滚到特定版本（传统方式）。

#### `list_history`
列出编辑历史记录。

### 会话管理

#### `create_session`
创建新的编辑会话来组织相关变更。

#### `get_current_session`
获取当前活动会话的信息。

#### `get_diff`
生成两个版本之间的差异比较。

## 🧠 智能特性

### AI增强分析

CodeRecoder集成了先进的AI分析能力：

- **代码复杂度评估** - 自动评估代码变更的复杂度
- **变更意图识别** - 智能识别变更类型（功能、修复、重构等）
- **影响范围分析** - 分析代码变更的潜在影响
- **Serena集成** - 深度代码结构和语义分析

### 智能变更检测

四重检测机制确保任何文件变更都能被准确捕获：

1. **Git状态检测** - 基于Git的变更状态
2. **文件统计对比** - 文件大小、修改时间对比
3. **内容哈希对比** - SHA256内容哈希验证
4. **时间戳检测** - 最近修改文件扫描

### 智能快照策略

- **增量快照** - 只保存变更的文件，节省存储空间
- **全量快照** - 定期创建完整项目副本作为基线
- **智能触发** - 基于变更量和时间间隔自动决定快照类型
- **链式恢复** - 增量快照自动关联依赖，确保完整恢复

## 🔧 高级配置

### 项目配置

在项目的`.CodeRecoder/config/project.json`中可以配置：

```json
{
  "projectName": "MyProject",
  "language": "typescript",
  "features": {
    "fileSnapshots": true,
    "projectSnapshots": true,
    "aiAnalysis": true,
    "autoBackup": false
  },
  "settings": {
    "maxSnapshots": 100,
    "autoCleanup": true,
    "fullSnapshotInterval": 10
  }
}
```

### 快照策略配置

```json
{
  "fullSaveInterval": 10,    // 每10次增量保存执行一次全量保存
  "maxSnapshots": 100,       // 最大快照数量
  "autoCleanup": true,       // 自动清理旧快照
  "excludePatterns": [       // 排除文件模式
    "node_modules",
    ".git",
    "*.log"
  ]
}
```

## 🛡️ 安全特性

### 数据安全

- **内容验证** - 快照恢复前验证文件完整性
- **备份机制** - 恢复前自动创建当前文件备份
- **原子操作** - 确保操作的原子性，避免部分失败
- **路径安全** - 严格的路径验证，防止目录遍历攻击

### 恢复安全

- **快照验证** - 恢复前检查快照内容和完整性
- **依赖检查** - 增量快照恢复前验证依赖链完整性
- **安全模式** - 移除危险的`--delete`参数，防止意外删除
- **回滚保护** - 提供多层次的回滚和恢复机制

## 🚀 性能优化

### 高性能特性

- **直接文件复制** - 避免内容分析开销，实现毫秒级快照
- **增量存储** - 只保存变更文件，大幅减少存储需求
- **并行处理** - 多文件操作支持并行执行
- **智能缓存** - 文件哈希和元数据缓存，避免重复计算

### 性能基准

- **文件快照** - < 50ms (单文件)
- **项目快照** - < 2s (100+ 文件项目)
- **快照恢复** - < 1s (完整项目恢复)
- **变更检测** - < 500ms (智能四重检测)

## 🤝 集成指南

### 与AI助手集成

CodeRecoder专为AI辅助编程设计，完美集成：

- **Claude Desktop** - 通过MCP协议原生支持
- **Cline** - VS Code扩展直接集成
- **其他MCP客户端** - 任何支持MCP的AI助手

### 工作流示例

```typescript
// 1. 激活项目
await activate_project({projectPath: "/my/project"});

// 2. 开发前创建检查点
await create_project_snapshot({
  prompt: "开始新功能开发",
  name: "开发起点",
  tags: ["checkpoint", "stable"]
});

// 3. 开发过程中创建文件快照
await create_file_snapshot({
  filePath: "/my/project/src/feature.ts",
  prompt: "实现核心逻辑"
});

// 4. 功能完成后创建项目快照
await create_project_snapshot({
  prompt: "新功能开发完成",
  name: "Feature X v1.0",
  tags: ["feature", "complete", "tested"]
});

// 5. 如需回滚
await restore_project_snapshot({
  snapshotId: "checkpoint-snapshot-id"
});
```

## 🔄 迁移指南

### 从其他工具迁移

#### 从Git迁移
```bash
# CodeRecoder可以与Git并存
# 激活项目后自动检测Git状态
activate_project {"projectPath": "/existing/git/project"}
```

#### 从Cursor迁移
CodeRecoder提供类似Cursor的快照功能：
- 使用`create_project_snapshot`替代Cursor的项目快照
- 使用`list_project_snapshots`查看快照历史
- 使用`restore_project_snapshot`恢复到特定状态

## 🐛 故障排除

### 常见问题

#### 快照创建失败
```bash
# 检查项目是否正确激活
get_project_info {}

# 检查磁盘空间
df -h

# 查看详细日志
tail -f .CodeRecoder/logs/debug.log
```

#### 恢复失败
```bash
# 验证快照完整性
list_project_snapshots {}

# 检查快照文件
ls -la .CodeRecoder/snapshots/projects/[snapshot-id]/
```

#### 变更检测不工作
```bash
# 检查文件基线
# 如果基线为空，会自动重建
create_project_snapshot {"prompt": "重建基线"}
```

### 调试模式

启用详细日志：
```bash
# 设置环境变量
export DEBUG=coderecoder:*
npm start
```

## 🤝 贡献指南

我们欢迎社区贡献！请遵循以下步骤：

### 开发环境设置

```bash
git clone https://github.com/yourusername/CodeRecoder.git
cd CodeRecoder
npm install
npm run build
```

### 提交指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 配置
- 添加适当的注释和文档
- 编写单元测试

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Model Context Protocol](https://modelcontextprotocol.io/) - 为AI助手提供结构化工具访问
- [Cursor](https://cursor.sh/) - 启发了项目快照和版本控制设计
- [TypeScript](https://www.typescriptlang.org/) - 提供类型安全和开发体验
- [Node.js](https://nodejs.org/) - 运行时环境

## 📊 项目统计

- **代码行数**: ~2,500 行 TypeScript
- **核心模块**: 8 个
- **MCP工具**: 18 个
- **支持的语言**: 全部（语言无关）
- **最低Node版本**: 18.0.0

## 🔗 相关链接

- [Model Context Protocol 文档](https://modelcontextprotocol.io/docs)
- [Claude Desktop 集成指南](https://claude.ai/docs/mcp)
- [TypeScript 官方文档](https://www.typescriptlang.org/docs)
- [问题反馈](https://github.com/yourusername/CodeRecoder/issues)

---

<div align="center">

**CodeRecoder** - 让AI辅助编程更加智能和安全

[⭐ 给个Star](https://github.com/yourusername/CodeRecoder) | [🐛 报告Bug](https://github.com/yourusername/CodeRecoder/issues) | [💡 功能建议](https://github.com/yourusername/CodeRecoder/discussions)

</div>