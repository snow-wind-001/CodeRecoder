#!/bin/bash

# CodeRecoder MCP Server 启动脚本
# 专为Cursor/Cline MCP集成设计

# 激活conda环境并启动服务器
cd /home/spikebai/owncode/CodeRecoder

# 检查conda环境
if ! command -v conda &> /dev/null; then
    echo "Error: conda not found" >&2
    exit 1
fi

# 激活manus环境
source $(conda info --base)/etc/profile.d/conda.sh
conda activate manus

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found in manus environment" >&2
    exit 1
fi

# 检查项目是否已构建
if [ ! -f "dist/index.js" ]; then
    echo "Building CodeRecoder..." >&2
    npm run build
fi

# 启动MCP服务器
exec node dist/index.js
