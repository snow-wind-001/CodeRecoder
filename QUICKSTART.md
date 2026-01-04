# CodeRecoder VSCode 快速参考

## 🚀 5分钟快速配置

### 1️⃣ 安装Cline扩展
```
VSCode → 扩展(Ctrl+Shift+X) → 搜索 "Cline" → 安装
```

### 2️⃣ 构建CodeRecoder
```bash
cd /home/spikebai/owncode/CodeRecoder
npm install
npm run build
```

### 3️⃣ 配置MCP服务器
打开VSCode设置 (`Ctrl+,`) → 搜索 "cline.mcpServers" → 添加：
```json
{
  "cline.mcpServers": {
    "coderecoder": {
      "command": "node",
      "args": ["/home/spikebai/owncode/CodeRecoder/dist/index.js"],
      "cwd": "/home/spikebai/owncode/CodeRecoder"
    }
  }
}
```

### 4️⃣ 重启VSCode
```
Ctrl+Shift+P → "Reload Window"
```

### 5️⃣ 测试连接
在Cline中输入：
```
请列出所有可用的MCP工具
```

✅ **完成！** 现在可以使用了

---

## 📝 常用命令速查

### 项目管理
```
# 激活项目
请激活项目 /path/to/your/project

# 查看项目信息
请获取当前项目信息

# 列出所有项目
请列出所有项目
```

### 文件快照
```
# 创建文件快照
请为 /path/to/file.js 创建快照，描述："添加新功能前的备份"

# 列出文件快照
请列出所有文件快照，按时间倒序，显示最近10个

# 恢复文件快照
请恢复快照ID为 xxx-xxx-xxx 的文件
```

### 项目快照
```
# 创建项目快照
请创建项目快照：
- 描述："功能开发完成"
- 名称："v1.0.0-stable"
- 标签：["stable", "tested"]

# 列出项目快照
请列出所有项目快照，使用详细格式

# 恢复项目快照
请恢复项目快照ID为 yyy-yyy-yyy
```

---

## 💡 典型工作流程

### 开发新功能
```
1. 请激活项目 /path/to/project
2. 请创建项目快照，描述："开始新功能前的检查点"
3. （开发功能...）
4. 请为修改的文件创建快照
5. 请创建项目快照，描述："新功能开发完成"
```

### 实验性修改
```
1. 请创建项目快照，描述："实验前的稳定版本"
2. （进行实验性修改...）
3. 如果成功 → 创建里程碑快照
4. 如果失败 → 恢复到步骤1的快照
```

### AI辅助重构
```
1. 请为所有要重构的文件创建快照
2. 请帮我重构 xxx 文件
3. 请为重构后的文件创建快照
4. 如果有问题 → 恢复到重构前的快照
```

---

## ⚠️ 常见问题

### MCP服务器连接失败
```bash
# 检查构建
cd /home/spikebai/owncode/CodeRecoder
npm run build

# 检查Node版本
node --version  # 需要 >= 18.0.0

# 检查路径配置
# 确保使用绝对路径，不要用 ~ 或相对路径
```

### 工具调用失败
```
# 确保项目已激活
请激活项目 /path/to/project

# 查看错误日志
cat .CodeRecoder/logs/error.log
```

### 快照恢复失败
```
# 验证快照完整性
请列出项目快照，显示详细信息

# 使用增量快照链恢复
系统会自动构建恢复链
```

---

## 🎯 最佳实践

✅ **DO** - 推荐做法
- 重要节点前创建项目快照
- 使用有意义的描述
- 定期清理旧快照
- 结合Git使用

❌ **DON'T** - 避免做法
- 不要每次小改动都创建项目快照
- 不要使用模糊的描述
- 不要跳过描述信息
- 不要把快照当作唯一备份

---

## 📞 获取帮助

- **详细文档**: `VSCODE_USAGE.md`
- **GitHub Issues**: https://github.com/spikebai/CodeRecoder/issues
- **查看日志**: `cat .CodeRecoder/logs/error.log`

---

**提示**: 将此文件加入VSCode书签或打印出来，方便随时查阅！
