#!/bin/bash

# CodeRecoder MCP 环境安装脚本
# 检查并安装所需的运行环境

echo "🔧 CodeRecoder MCP 环境检查与安装"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查是否为root用户
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ 请不要以root用户运行此脚本${NC}"
   exit 1
fi

# 检查操作系统
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${RED}❌ 此脚本仅支持Linux系统${NC}"
    exit 1
fi

echo -e "${BLUE}📋 检查系统环境...${NC}"

# 检查Node.js
echo -n "检查Node.js... "
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ 已安装 ($NODE_VERSION)${NC}"
    NODE_INSTALLED=true
else
    echo -e "${YELLOW}❌ 未安装${NC}"
    NODE_INSTALLED=false
fi

# 检查npm
echo -n "检查npm... "
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✅ 已安装 ($NPM_VERSION)${NC}"
    NPM_INSTALLED=true
else
    echo -e "${YELLOW}❌ 未安装${NC}"
    NPM_INSTALLED=false
fi

# 安装Node.js和npm
if [[ "$NODE_INSTALLED" = false ]] || [[ "$NPM_INSTALLED" = false ]]; then
    echo ""
    echo -e "${YELLOW}📦 需要安装Node.js和npm${NC}"
    echo "选择安装方式:"
    echo "1. 使用NodeSource官方源 (推荐)"
    echo "2. 使用系统包管理器 (apt)"
    echo "3. 使用Node Version Manager (nvm)"
    echo "4. 跳过安装 (手动安装)"
    echo ""
    read -p "请选择 (1-4): " choice

    case $choice in
        1)
            echo -e "${BLUE}📦 使用NodeSource安装Node.js LTS...${NC}"
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        2)
            echo -e "${BLUE}📦 使用apt安装Node.js...${NC}"
            sudo apt update
            sudo apt install -y nodejs npm
            ;;
        3)
            echo -e "${BLUE}📦 使用nvm安装Node.js...${NC}"
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
            export NVM_DIR="$HOME/.nvm"
            [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
            [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
            nvm install --lts
            nvm use --lts
            ;;
        4)
            echo -e "${YELLOW}⚠️  跳过Node.js安装，请手动安装后重新运行此脚本${NC}"
            echo "推荐安装命令:"
            echo "  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
            echo "  sudo apt-get install -y nodejs"
            exit 1
            ;;
        *)
            echo -e "${RED}❌ 无效选择${NC}"
            exit 1
            ;;
    esac
fi

echo ""
echo -e "${BLUE}🔍 重新检查环境...${NC}"

# 重新检查Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js: $NODE_VERSION${NC}"
else
    echo -e "${RED}❌ Node.js安装失败${NC}"
    exit 1
fi

# 重新检查npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✅ npm: $NPM_VERSION${NC}"
else
    echo -e "${RED}❌ npm安装失败${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📦 安装项目依赖...${NC}"

# 检查package.json
if [[ ! -f "package.json" ]]; then
    echo -e "${RED}❌ 未找到package.json文件${NC}"
    exit 1
fi

# 安装依赖
echo "正在安装依赖包..."
npm install

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✅ 依赖安装成功${NC}"
else
    echo -e "${RED}❌ 依赖安装失败${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🏗️  构建项目...${NC}"

# 构建TypeScript
npm run build

if [[ $? -eq 0 ]]; then
    echo -e "${GREEN}✅ 项目构建成功${NC}"
else
    echo -e "${RED}❌ 项目构建失败${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🧪 测试MCP服务器...${NC}"

# 测试MCP服务器基本功能
echo "测试工具列表..."
TOOLS_TEST=$(echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | timeout 5s node dist/index.js 2>/dev/null | grep -o '"tools"' | wc -l)

if [[ $TOOLS_TEST -gt 0 ]]; then
    echo -e "${GREEN}✅ MCP服务器响应正常${NC}"
else
    echo -e "${YELLOW}⚠️  MCP服务器测试未通过（可能是超时或配置问题）${NC}"
fi

echo ""
echo -e "${GREEN}🎉 环境安装完成！${NC}"
echo ""
echo -e "${BLUE}📋 下一步操作:${NC}"
echo "1. 配置MCP客户端:"
echo "   ./update-mcp-config.sh"
echo ""
echo "2. 启动紧凑GUI (可选):"
echo "   ./start-compact-gui.sh"
echo ""
echo "3. 测试MCP服务器:"
echo "   echo '{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": {}}' | node dist/index.js"
echo ""
echo -e "${BLUE}📖 可用工具:${NC}"
echo "   • activate_project   - 激活项目"
echo "   • record_edit       - 记录编辑"
echo "   • rollback_to_version - 版本回退"
echo "   • list_history      - 查看历史"
echo "   • create_session    - 创建会话"
echo "   • get_project_info  - 获取项目信息"
echo ""
echo -e "${YELLOW}💡 提示: 重启终端或运行 'source ~/.bashrc' 以确保环境变量生效${NC}"
