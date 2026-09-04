# 在 VS Code 中使用 CodeRecoder

## 构建服务

```bash
cd /absolute/path/CodeRecoder
npm install
npm run build
```

VS Code 集成使用 stdio MCP，不会自动读取当前工作区；每个客户端进程都必须显式调用 `activate_project`。仓库另有独立的 Electron 桌面控制台，可运行 `npm run desktop:start` 查看和控制同一格式的备份，但它不会替代或隐式连接 VS Code 内的 MCP 会话。

## Codex IDE 扩展

Codex CLI 与 IDE 扩展共享 MCP 配置。运行：

```bash
codex mcp add coderecoder -- node /absolute/path/CodeRecoder/dist/index.js
codex mcp list
```

重启扩展后，从齿轮菜单的 **MCP servers** 检查连接状态。OpenAI 当前配置说明见 [Codex MCP 文档](https://developers.openai.com/codex/mcp)。

## 其他 VS Code 智能体扩展

若扩展支持 `mcpServers` JSON，可按其文档加入：

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

不同扩展的配置文件位置和顶层字段并不统一；不要把 Cursor/Cline 的路径直接假定为 VS Code 全局标准。

## 首次调用

建议对源工程使用独立备份磁盘：

```text
请使用 coderecoder 激活 /work/project，
storageRoot 设为 /data/coderecoder，启用自动检查点，
然后报告备份状态。
```

激活成功必须包含 `activationCheckpoint`，且 `automaticCheckpoint.state` 应为 `running`。如果是 `degraded`，先处理 `lastError`，不要假定自动备份仍可靠。

## 日常提示词

```text
请创建名为 before-refactor 的项目备份，并标记 stable。
```

```text
请列出最近 10 个备份，并验证我要恢复的那个快照。
```

```text
请只预览将快照 <UUID> 以 exact 模式恢复会产生的变化，不要执行恢复。
```

看到预览后再明确决定是否执行。恢复工具需要预览返回的短期令牌，并会强制创建恢复前安全备份。不要将恢复或删除加入扩展的自动批准列表。

## 会话结束

调用 `deactivate_project` 停止监听。默认会创建最终检查点。关闭 VS Code 或 MCP 进程也会停止自动检查点；若需要全天候备份，应让 MCP 客户端保持运行并定期检查状态。

## 常见问题

- 工具未出现：运行 `npm run build`，检查绝对路径并重启扩展。
- 状态显示未备份变化：创建手动快照或等待一次防抖/周期对账。
- 恢复令牌失效：文件在预览后发生变化或超过五分钟，重新预览。
- 不希望工程出现 `.CodeRecoder`：激活时设置工程外的 `storageRoot`。
- `.env` 未被恢复：这是默认安全排除行为；敏感配置应使用专用密钥备份方案。
