#!/bin/bash

# CodeRecoder MCP 配置验证脚本

echo "🔍 CodeRecoder MCP 配置验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查MCP配置文件
echo -e "${BLUE}📋 检查MCP配置文件...${NC}"
MCP_CONFIG="/home/spikebai/.cursor/mcp.json"
if [[ -f "$MCP_CONFIG" ]]; then
    echo -e "${GREEN}✅ MCP配置文件存在: $MCP_CONFIG${NC}"
    
    # 检查是否包含coderecoder配置
    if grep -q "coderecoder" "$MCP_CONFIG"; then
        echo -e "${GREEN}✅ CodeRecoder配置已添加${NC}"
    else
        echo -e "${RED}❌ 未找到CodeRecoder配置${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ MCP配置文件不存在${NC}"
    exit 1
fi

# 检查启动脚本
echo -e "${BLUE}📋 检查启动脚本...${NC}"
START_SCRIPT="/home/spikebai/owncode/CodeRecoder/start-mcp-server.sh"
if [[ -f "$START_SCRIPT" && -x "$START_SCRIPT" ]]; then
    echo -e "${GREEN}✅ 启动脚本存在且可执行${NC}"
else
    echo -e "${RED}❌ 启动脚本问题${NC}"
    exit 1
fi

# 检查项目构建
echo -e "${BLUE}📋 检查项目构建状态...${NC}"
DIST_FILE="/home/spikebai/owncode/CodeRecoder/dist/index.js"
if [[ -f "$DIST_FILE" ]]; then
    echo -e "${GREEN}✅ 项目已构建${NC}"
else
    echo -e "${YELLOW}⚠️  项目未构建，正在构建...${NC}"
    cd /home/spikebai/owncode/CodeRecoder
    source $(conda info --base)/etc/profile.d/conda.sh
    conda activate manus
    npm run build
    if [[ $? -eq 0 ]]; then
        echo -e "${GREEN}✅ 项目构建成功${NC}"
    else
        echo -e "${RED}❌ 项目构建失败${NC}"
        exit 1
    fi
fi

# 测试MCP服务器
echo -e "${BLUE}📋 测试MCP服务器...${NC}"
cd /home/spikebai/owncode/CodeRecoder
TEST_RESULT=$(echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | timeout 10s "$START_SCRIPT" 2>/dev/null | grep -o '"tools"' | wc -l)

if [[ $TEST_RESULT -gt 0 ]]; then
    echo -e "${GREEN}✅ MCP服务器响应正常${NC}"
else
    echo -e "${RED}❌ MCP服务器测试失败${NC}"
    echo -e "${YELLOW}💡 尝试手动测试: echo '{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": {}}' | $START_SCRIPT${NC}"
    exit 1
fi

# 检查Web GUI
echo -e "${BLUE}📋 检查Web GUI状态...${NC}"
if pgrep -f "gui.js" > /dev/null; then
    echo -e "${GREEN}✅ Web GUI正在运行 (http://localhost:3001)${NC}"
else
    echo -e "${YELLOW}⚠️  Web GUI未运行 (可选功能)${NC}"
    echo -e "${YELLOW}💡 启动命令: ./start-compact-gui.sh${NC}"
fi

echo ""
echo -e "${GREEN}🎉 配置验证完成！${NC}"
echo ""
echo -e "${BLUE}📋 下一步操作:${NC}"
echo "1. 重启Cursor以加载新的MCP配置"
echo "2. 在Cline中测试: '请列出可用的MCP工具'"
echo "3. 激活项目: '请激活当前项目用于代码跟踪'"
echo "4. 可选：启动GUI监控面板"
echo ""
echo -e "${BLUE}📖 详细测试指南:${NC}"
echo "   查看文件: /home/spikebai/owncode/CodeRecoder/MCP_TEST_GUIDE.md"
echo ""
echo -e "${BLUE}🎨 Web GUI (可选):${NC}"
echo "   启动: ./start-compact-gui.sh"
echo "   访问: http://localhost:3001"
echo "   建议: 调整为320x600像素小窗体，放置在VSCode旁边"
