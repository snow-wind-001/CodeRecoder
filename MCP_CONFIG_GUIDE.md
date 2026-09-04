# CodeRecoder MCP 配置指南

## 前置条件

```bash
cd /absolute/path/CodeRecoder
npm install
npm run build
```

客户端必须以 stdio 方式启动 `node /absolute/path/CodeRecoder/dist/index.js`。请使用绝对路径；服务不会依赖客户端当前打开的工程。

## Codex

OpenAI 官方文档给出的 stdio 形式是 `codex mcp add <name> -- <command>`：

```bash
codex mcp add coderecoder -- node /absolute/path/CodeRecoder/dist/index.js
codex mcp list
```

CLI、Codex IDE 扩展和同一 Codex 主机上的 ChatGPT 桌面端共享 `~/.codex/config.toml`。也可以直接配置：

```toml
[mcp_servers.coderecoder]
command = "node"
args = ["/absolute/path/CodeRecoder/dist/index.js"]
cwd = "/absolute/path/CodeRecoder"
```

参考：[OpenAI Codex MCP 文档](https://developers.openai.com/codex/mcp)。

## Claude Code

stdio 是默认 transport：

```bash
claude mcp add --scope user coderecoder -- node /absolute/path/CodeRecoder/dist/index.js
claude mcp list
```

若只希望当前工程使用，改用 `--scope project`。在 Claude Code 中运行 `/mcp` 检查连接。

## Cursor/Cline 类 JSON 配置

客户端字段可能随版本变化；支持传统 `mcpServers` 格式时可使用：

```json
{
  "mcpServers": {
    "coderecoder": {
      "command": "node",
      "args": ["/absolute/path/CodeRecoder/dist/index.js"],
      "cwd": "/absolute/path/CodeRecoder"
    }
  }
}
```

修改配置后重启客户端，并检查工具列表中是否出现 9 个生产工具。

## 批准策略

可考虑自动批准只读工具：

- `get_backup_status`
- `list_project_snapshots`
- `verify_project_snapshot`

`create_project_snapshot` 只增加备份数据，但会占用磁盘。`activate_project` 会建立基线并可能在工程内创建 `.CodeRecoder`；对受保护工程应传入外部 `storageRoot`。

不得无条件自动批准：

- `restore_project_snapshot`：会覆盖或删除受管代码；必须先预览并获得用户确认。
- `delete_project_snapshot`：永久删除备份；必须由用户明确指定同一 UUID 两次。

`preview_project_restore` 会持久化短期令牌，虽不修改源代码，也不应被描述为纯只读操作。

## 推荐调用顺序

```text
activate_project
  ├─ get_backup_status
  ├─ create_project_snapshot / 自动检查点
  ├─ list_project_snapshots
  └─ preview_project_restore
       └─ 用户确认
            └─ restore_project_snapshot
deactivate_project
```

激活示例：

```json
{
  "projectPath": "/work/project",
  "storageRoot": "/data/coderecoder",
  "autoCheckpoint": true,
  "debounceMs": 1500,
  "reconciliationIntervalMs": 60000,
  "maxBackups": 100,
  "excludeNames": ["vendor-generated"]
}
```

## 故障排除

```bash
node --version
npm run lint
npm test
node dist/index.js
```

- 客户端无工具：确认已构建且配置使用绝对路径，然后重启客户端。
- JSON-RPC 解析失败：stdout 必须只含协议数据；自定义日志只能写 stderr。
- 自动备份未运行：调用 `get_backup_status`，检查 `automaticCheckpoint.state` 和 `lastError`。
- 恢复令牌被拒绝：工程在预览后已变化、令牌已过期或已使用；重新预览。
- 工程不可写：恢复需要工程写权限；仅备份时可把 `storageRoot` 指向可写外部目录。
