# CodeRecoder 快速开始

## 1. 安装

```bash
cd /absolute/path/CodeRecoder
npm install
npm test
```

要求 Node.js 22.12.0+。`npm test` 会先构建，再运行隔离的备份/恢复、桌面控制器和 MCP 协议测试。

## 2. 启动桌面控制台（可选）

```bash
npm run desktop:start
```

在竖向窗口中选择工程与外部备份位置，即可查看保护状态、验证快照并执行带预览确认的恢复。开发界面使用 `npm run desktop:dev`；桌面端与 MCP 共用备份格式和跨进程锁，但各自维护进程内激活状态。

## 3. 连接 MCP 客户端

Codex：

```bash
codex mcp add coderecoder -- node /absolute/path/CodeRecoder/dist/index.js
codex mcp list
```

Claude Code：

```bash
claude mcp add --scope user coderecoder -- node /absolute/path/CodeRecoder/dist/index.js
claude mcp list
```

连接后可用 `/mcp` 或客户端的工具列表确认 `coderecoder` 已上线。

## 4. 激活备份

向客户端提出：

```text
请调用 coderecoder 的 activate_project，保护 /work/my-project，
将备份保存到 /data/coderecoder-backups，并启用自动检查点。
```

对应参数：

```json
{
  "projectPath": "/work/my-project",
  "storageRoot": "/data/coderecoder-backups",
  "autoCheckpoint": true,
  "maxBackups": 100
}
```

省略 `storageRoot` 时会写入工程内的 `.CodeRecoder/backups`。不希望受保护工程出现任何备份元数据时，应始终指定外部目录。

## 5. 日常使用

自动监听会合并短时间内的连续修改。重要节点仍建议创建命名备份：

```json
{
  "name": "before-auth-refactor",
  "prompt": "认证模块重构前的已验证检查点",
  "tags": ["stable", "auth"]
}
```

使用 `get_backup_status` 检查：

- `hasUncheckpointedChanges` 是否为 `false`；
- `automaticCheckpoint.state` 是否为 `running`；
- `lastError` 是否为空。

使用 `list_project_snapshots` 获取快照 UUID，使用 `verify_project_snapshot` 重新校验重要备份。

## 6. 安全恢复

先调用：

```json
{
  "snapshotId": "目标快照 UUID",
  "mode": "exact"
}
```

`preview_project_restore` 会返回变更列表和五分钟有效的 `confirmationToken`。检查列表并明确确认后，再调用：

```json
{
  "snapshotId": "相同的目标快照 UUID",
  "confirmationToken": "预览返回的令牌"
}
```

不要手工构造或重复使用令牌。`exact` 删除目标快照中不存在的受管代码；`overlay` 只覆盖已有快照路径。恢复前安全备份、结果验证和失败回滚均由服务强制执行。

## 7. 停止监听

调用 `deactivate_project`。默认会先创建最终检查点；传入 `{"createFinalCheckpoint": false}` 可跳过。自动备份只在 MCP 服务运行且项目已激活时生效。
