# CodeRecoder Desktop

CodeRecoder Desktop 是基于 Vue 3 和 Electron 的本地备份控制小窗。默认内容尺寸为 `424×880`，可在 `380–560px` 宽度内调整，适合贴靠在编辑器旁持续观察。

## 使用方式

```bash
npm run desktop:dev       # 启动热更新开发环境
npm run desktop:typecheck # 检查 renderer、preload 和主进程类型
npm run desktop:build     # 构建到 dist-desktop/
npm run desktop:start     # 构建并启动桌面应用
npm run desktop:install-linux # 安装并固定到 Ubuntu/GNOME 程序栏
npm run test:desktop      # 运行桌面控制器集成测试
```

Linux 启动项安装在当前用户的应用目录，不需要 `sudo`。它引用当前仓库路径，并会自动选择满足 `>=22.12.0` 的 NVM Node.js；移动仓库后请重新安装启动项。

首次启动后选择需要保护的工程及外部备份根目录。主视图展示自动检查点健康度、未备份变更、备份位置、恢复/回滚状态和最近 200 个快照。每个快照可重新验证 SHA-256 清单，或进入恢复预览。

## 恢复流程

“精确恢复”会同步到快照状态，“覆盖恢复”会保留额外文件。两种模式都先验证目标并生成五分钟有效的确认令牌。确认后，备份引擎会创建受保护的恢复前快照、应用内容并再次校验；失败时自动回滚，结果会明确显示在主视图。

## 安全边界

- `electron/main.ts` 管理窗口、目录选择和白名单 IPC。
- `electron/preload.ts` 只暴露经过参数校验的 `window.codeRecoder` 方法。
- `renderer/` 没有 Node、文件系统、环境变量或通用 IPC 权限。
- 导航、新窗口和权限请求默认拒绝；开发页面仅允许本机回环地址。
- 与 MCP 同时操作同一工程时，由备份引擎的跨进程锁串行化写入。

桌面端只持久化权限为 `0600` 的最近配置，不持久化全局活动工程。运行数据位于 Electron `userData` 目录；构建产物 `dist-desktop/` 不应提交。

## 实例与工程模型

当前桌面端保持单实例，第二次启动只会聚焦已有窗口；一个窗口同一时间只监控一个工程，切换或退出前会尝试创建最终检查点。并行保护多个工程可使用多个独立 MCP 服务进程。未来桌面多工程应优先在一个 Electron 进程内维护多个隔离会话，必要时为会话创建多个窗口，而不是默认多开完整应用进程。
