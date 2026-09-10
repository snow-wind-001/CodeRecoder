# Linux 安装包与发布

## 制作与验证

在 Linux amd64、Node.js 22.12+、npm 环境下执行：

```bash
npm ci
npm run lint
npm test
npm run desktop:deb
npm run desktop:verify-deb -- release/CodeRecoder-3.1.0-amd64.deb
cd release
sha256sum ./*.deb > SHA256SUMS
```

包验证还需要 `dpkg-deb`、`desktop-file-validate`（Debian/Ubuntu 的 `desktop-file-utils`）。验证过程在临时目录解包、检查菜单入口和安装脚本，并从仓库外启动真实 MCP；测试通过一个故意失败的 `node` 命令确认其使用 Electron 内置运行时。该检查不会安装系统文件，也不会恢复真实工程。

完整系统安装及 GUI 验证：

```bash
sudo apt install ./release/CodeRecoder-3.1.0-amd64.deb
coderecoder
```

安装器提供 `/opt/CodeRecoder` 中的桌面应用、`/usr/bin/coderecoder-mcp` 和 `coderecoder-install-serena`，并注册 `coderecoder.desktop`。保留 electron-builder 的标准安装/卸载脚本，包括系统菜单、AppArmor 和沙箱处理，再追加本项目的命令入口。

用户数据仍位于 `~/.config/CodeRecoder`，卸载不删除工程、备份或独立 Serena 环境。安装包不包含用户配置、语言服务缓存、Serena 源码或 .NET SDK；通过可选 Serena 安装命令联网准备这些组件。

源码版与安装版共用桌面入口名称。如果用户目录存在旧源码快捷方式，应先备份移走 `~/.local/share/applications/coderecoder.desktop`，使系统安装包的入口生效。安装包不以 root 身份批量改写用户桌面设置。

## GitHub 自动发布

`.github/workflows/linux-release.yml` 对主分支、PR 和手动运行执行构建测试，安装 `.deb`，通过虚拟显示验证 GUI，并上传安装包及 `SHA256SUMS` 作为 Actions artifact。

发布前确保工作区已提交、完整测试通过，并将 `package.json`、服务版本和 `docs/releases/v<version>.md` 同步。随后推送代码和匹配版本的标签：

```bash
git push origin main
git tag v3.1.0
git push origin v3.1.0
```

版本标签触发的工作流仅在构建、系统安装、GUI 与 MCP 检查全部通过后创建 GitHub Release，并上传已验证的 `.deb` 与校验和。发布作业使用仓库自带 `GITHUB_TOKEN` 的 `contents: write` 权限，无需把个人令牌写入仓库。仅本地生成文件或提交工作流并不代表已完成 GitHub 发布，需检查 Actions 与 Releases 的实际结果。

当前仅提供 amd64；更新通过下载并安装新的 `.deb` 完成。
