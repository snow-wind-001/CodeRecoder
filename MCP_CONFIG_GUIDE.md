# CodeRecoder MCP 配置指南

## 📋 配置文件位置

MCP配置文件位于：`~/.cursor/mcp.json`

## 🔧 当前配置说明

### CodeRecoder MCP服务器配置

```json
{
  "mcpServers": {
    "coderecoder": {
      "command": "/home/spikebai/owncode/CodeRecoder/start-mcp-server.sh",
      "args": [],
      "autoApprove": [
        "activate_project",
        "list_projects",
        "get_project_info",
        "get_current_session",
        "list_history",
        "create_project_snapshot",
        "list_project_snapshots",
        "restore_project_snapshot",
        "launch_gui",
        "create_file_snapshot",
        "list_file_snapshots",
        "restore_file_snapshot",
        "delete_file_snapshot"
      ]
    }
  }
}
```

## 🎯 工具分类说明

### 🆕 新架构工具（Cursor风格 - 推荐使用）

#### 1. **项目级快照工具**（按保存次数管理）

| 工具名称 | 功能 | 使用场景 |
|---------|------|---------|
| `create_project_snapshot` | 创建项目快照 | 完成功能后保存整个项目状态 |
| `list_project_snapshots` | 列出项目快照 | 查看所有保存历史 |
| `restore_project_snapshot` | 恢复项目快照 | 回退到之前的项目状态 |

**特点：**
- ✅ 按保存次数管理（类似Cursor）
- ✅ 智能增量+全量策略（每10次增量做1次全量）
- ✅ 集成Serena分析自动检测变更文件
- ✅ 项目级别管理，完整状态保存

#### 2. **GUI工具**

| 工具名称 | 功能 | 使用场景 |
|---------|------|---------|
| `launch_gui` | 启动Tkinter GUI | 需要可视化界面管理快照时 |

### 📁 传统工具（单文件快照 - 兼容保留）

| 工具名称 | 功能 | 状态 |
|---------|------|------|
| `create_file_snapshot` | 创建单文件快照 | 保留（向后兼容） |
| `list_file_snapshots` | 列出文件快照 | 保留（向后兼容） |
| `restore_file_snapshot` | 恢复文件快照 | 保留（向后兼容） |
| `delete_file_snapshot` | 删除文件快照 | 保留（向后兼容） |

### 🔧 项目管理工具

| 工具名称 | 功能 |
|---------|------|
| `activate_project` | 激活项目 |
| `list_projects` | 列出所有项目 |
| `get_project_info` | 获取项目信息 |
| `get_current_session` | 获取当前会话 |
| `list_history` | 列出历史记录 |

## 🚀 使用示例

### 在Cline中的使用

#### 1. 激活项目并启动GUI

```bash
activate_project {
  "projectPath": "/path/to/your/project",
  "autoLaunchGUI": true
}
```

#### 2. 创建项目快照（推荐）

```bash
create_project_snapshot {
  "prompt": "完成用户认证功能 - 添加登录和注册"
}
```

#### 3. 查看所有快照

```bash
list_project_snapshots {
  "format": "compact"
}
```

#### 4. 恢复项目状态

```bash
restore_project_snapshot {
  "snapshotId": "快照ID"
}
```

#### 5. 手动启动GUI

```bash
launch_gui {}
```

## 📊 工具优先级建议

### 推荐工作流程

1. **项目激活** → `activate_project`
2. **创建快照** → `create_project_snapshot`（新架构）
3. **查看快照** → `list_project_snapshots`（新架构）
4. **恢复快照** → `restore_project_snapshot`（新架构）
5. **GUI管理** → `launch_gui`（需要可视化时）

### 何时使用传统工具

- 只需要保存单个文件时
- 需要精确控制文件级别快照时
- 兼容旧工作流程时

## ⚙️ autoApprove 说明

`autoApprove` 列表中的工具会在Cline中自动批准执行，无需手动确认。这包括：

- ✅ 所有查询类工具（list, get）
- ✅ 项目激活工具
- ✅ 快照创建工具（安全操作）
- ✅ GUI启动工具

**注意：** 恢复和删除操作虽然也在列表中，但建议在重要项目中谨慎使用。

## 🔄 配置更新历史

### 最新更新（Cursor风格架构）

- ✅ 添加 `create_project_snapshot` - 项目级快照创建
- ✅ 添加 `list_project_snapshots` - 项目快照列表
- ✅ 添加 `restore_project_snapshot` - 项目快照恢复
- ✅ 添加 `launch_gui` - GUI启动命令
- ✅ 保留传统文件快照工具（向后兼容）

## 🐛 故障排除

### 问题：MCP服务器无法启动

**解决方案：**
1. 检查启动脚本权限：`chmod +x /home/spikebai/owncode/CodeRecoder/start-mcp-server.sh`
2. 检查conda环境：确保`manus`环境存在
3. 检查项目构建：运行 `npm run build`

### 问题：工具调用失败

**解决方案：**
1. 检查MCP服务器日志
2. 验证项目是否已激活：`get_project_info`
3. 检查工具参数格式是否正确

### 问题：GUI无法启动

**解决方案：**
1. 检查DISPLAY环境变量：`echo $DISPLAY`
2. 手动启动测试：`python3 src/tkinter_gui.py`
3. 检查Python和Tkinter安装

## 📚 相关文档

- [README.md](./README.md) - 完整功能文档
- [VSCODE_USAGE.md](./VSCODE_USAGE.md) - VSCode使用指南

## 💡 最佳实践

1. **优先使用项目快照**：新架构更符合Cursor使用习惯
2. **定期创建快照**：完成重要功能后立即保存
3. **使用GUI管理**：复杂操作时使用图形界面
4. **合理设置保存间隔**：默认每10次增量做1次全量保存

---

**最后更新：** 2025-01-12  
**版本：** 2.0.0 (Cursor风格架构)