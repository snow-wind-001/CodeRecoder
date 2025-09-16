#!/bin/bash

# CodeRecoder MCP Setup Script
# This script installs dependencies and builds the project

echo "🔧 Setting up CodeRecoder MCP Server..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js and npm first:"
    echo "   sudo apt install npm nodejs"
    echo "   # or"
    echo "   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🏗️  Building TypeScript..."
npm run build

# Make the entry point executable
echo "🔐 Setting executable permissions..."
chmod +x dist/index.js

echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add this server to your MCP configuration:"
echo "   {\"coderecoder\": {\"command\": \"node\", \"args\": [\"$(pwd)/dist/index.js\"]}}"
echo ""
echo "2. For Cline integration, update ~/.cursor/mcp.json:"
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"serena\": {"
echo "         \"command\": \"uvx\","
echo "         \"args\": [\"--from\", \"git+https://github.com/oraios/serena\", \"serena-mcp-server\"]"
echo "       },"
echo "       \"coderecoder\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$(pwd)/dist/index.js\"]"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "3. Restart your MCP client (Cline/Cursor) to load the new server"
echo ""
echo "🧪 Test the server:"
echo "   echo '{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": {}}' | node dist/index.js"
echo ""
echo "🎨 Start the Web GUI (optional):"
echo "   npm run gui"
echo "   # Then open http://localhost:3001 in your browser"
