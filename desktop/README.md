# CodeRecoder Desktop

CodeRecoder Desktop 是基于 Vue 3 和 Electron 的本地备份控制小窗。默认内容尺寸为 `424×880`，可在 `380–560px` 宽度内调整，适合贴靠编辑器长期观察。

## 使用方式

```bash
npm run desktop:dev           # Electron + Vite 热更新
npm run desktop:typecheck     # 检查 renderer、preload 和 main
npm run desktop:build         # 构建到 dist-desktop/
npm run desktop:start         # 构建并启动桌面应用
npm run desktop:install-linux # 安装并固定到 GNOME 程序栏
npm run desktop:deb           # 生成 release/CodeRecoder-<version>-amd64.deb
npm run test:desktop          # 桌面集成测试
```

Linux 安装命令会先检查并补齐 Electron 运行程序、完成构建，再安装当前用户的快捷方式并核对 GNOME 固定结果，不需要 `sudo`。`npm install` 和普通构建不会自动注册快捷方式。启动项引用当前仓库路径，并自动选择满足 `>=22.12.0` 的 Node.js（包括 NVM 安装）；移动仓库后需重新安装启动项。

Electron 下载会使用已有的 `HTTP_PROXY` / `HTTPS_PROXY`（也支持小写变量）。从程序栏启动时，日志写入 `${XDG_STATE_HOME:-~/.local/state}/coderecoder/desktop-launch.log`；运行 `bash desktop/start-coderecoder-desktop.sh --prepare` 可在终端检查运行环境并构建，不打开窗口。

## 多工程会话

应用保持单 Electron 实例，由 `ProjectSessionRegistry` 管理多个工程。每个工程拥有独立的：

- `BackupManager`、`AutoCheckpointManager` 和串行操作队列；
- 快照、恢复证据、错误与健康状态；
- Serena 配置检查、sidecar 进程和动态回环 endpoint。

主窗口汇总全部工程。需要并排查看时，可为工程创建一个独立窗口；重复打开会聚焦现有窗口，关闭该窗口不会停止保护。停止或退出时会先尝试创建最终检查点。重复、父子嵌套以及与备份目录重叠的工程会被拒绝。

偏好以 schema v2、`0600` 权限原子保存。旧单工程偏好会迁移，但默认不自动启动。

## MCP 配置工作台

标题栏设置按钮会打开连接工作台，检查 Node.js、`dist/index.js`、Serena CLI、工程配置及 VS Code、Cursor、Claude Code、Codex 客户端。选择客户端与 CodeRecoder/Serena 后，可以复制按本机绝对路径生成的 JSON 或 CLI 命令。

工作台不覆盖客户端配置。复制动作由主进程针对白名单目标重新生成文本，renderer 没有通用剪贴板、文件系统或命令执行权限。Serena HTTP endpoint 仅用于显示当前 sidecar 就绪状态，长期配置应使用 stdio 建议。

## Serena 启动与恢复

缺少 CLI 时，连接工作台提供“下载并安装 Serena”，自动准备独立 Python 环境。终端可运行 `npm run serena:install` 或安装包提供的 `coderecoder-install-serena`；C# 工程在命令后增加 `--with-dotnet`（npm 命令使用 `-- --with-dotnet`）。安装操作可在退出应用时取消，失败日志保存在用户数据目录下的 `logs/serena-install.log`。

启用后，桌面端会发现可执行文件、按需创建 `.serena/project.yml`、以固定参数绑定 `127.0.0.1`，并通过真实 MCP `initialize` 握手确认就绪。

后台创建配置保留检测到的主要语言，可选语言需要在 `language_servers` 中配置。语言服务可能另需 Node.js/npm 或 .NET；握手成功后仍应验证所用语言的符号查询。

若明确检测到 `Error loading configuration` 且自动配置已开启，原配置会先保存为 `.coderecoder-invalid-<timestamp>.bak`，再由 `serena project create` 重建；重建失败则尝试恢复原文件。Serena 降级不会改变备份健康状态。

## 恢复流程

“精确恢复”同步到快照状态，“覆盖恢复”保留额外文件。两者都先验证目标并生成五分钟确认令牌。确认后，内核创建受保护的恢复前快照、应用内容并再次校验；失败时自动回滚。

## 安全边界

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- preload 只暴露类型化白名单，main 再次验证参数、来源和窗口绑定的 `projectId`。
- 工程窗口不能跨会话操作；导航、新窗口和权限请求默认拒绝。
- Serena 不经过 shell，只能使用固定参数启动，且仅监听本机回环地址。
- MCP 与桌面同时操作同一工程时，跨进程工程锁会串行化关键写入。

运行数据位于 Electron `userData` 目录；`dist-desktop/` 不应提交。主 README 参见 [`../README.md`](../README.md)。

安装包制作、验证和发布步骤见 [`../docs/LINUX_RELEASE.md`](../docs/LINUX_RELEASE.md)。
