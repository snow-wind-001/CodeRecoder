#!/bin/bash

# CodeRecoder MCP Configuration Updater
# This script helps update your MCP configuration to include CodeRecoder

MCP_CONFIG_PATH="$HOME/.cursor/mcp.json"
CURRENT_DIR="$(pwd)"

echo "🔧 Updating MCP configuration for CodeRecoder..."

# Check if the MCP config exists
if [[ ! -f "$MCP_CONFIG_PATH" ]]; then
    echo "❌ MCP configuration file not found at $MCP_CONFIG_PATH"
    echo "Creating a new configuration file..."
    
    mkdir -p "$(dirname "$MCP_CONFIG_PATH")"
    
    cat > "$MCP_CONFIG_PATH" << EOF
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/oraios/serena",
        "serena-mcp-server"
      ]
    },
    "coderecoder": {
      "command": "node",
      "args": ["$CURRENT_DIR/dist/index.js"]
    }
  }
}
EOF
    
    echo "✅ Created new MCP configuration with CodeRecoder and Serena"
else
    echo "📋 Existing MCP configuration found"
    echo "📝 Current configuration:"
    cat "$MCP_CONFIG_PATH"
    echo ""
    
    # Create backup
    cp "$MCP_CONFIG_PATH" "$MCP_CONFIG_PATH.backup.$(date +%s)"
    echo "💾 Backup created: $MCP_CONFIG_PATH.backup.$(date +%s)"
    
    # Check if coderecoder already exists
    if grep -q '"coderecoder"' "$MCP_CONFIG_PATH"; then
        echo "⚠️  CodeRecoder configuration already exists"
        echo "🔄 Updating the path to current directory..."
        
        # Update the existing configuration
        python3 -c "
import json
import sys

try:
    with open('$MCP_CONFIG_PATH', 'r') as f:
        config = json.load(f)
    
    if 'mcpServers' not in config:
        config['mcpServers'] = {}
    
    config['mcpServers']['coderecoder'] = {
        'command': 'node',
        'args': ['$CURRENT_DIR/dist/index.js']
    }
    
    with open('$MCP_CONFIG_PATH', 'w') as f:
        json.dump(config, f, indent=2)
    
    print('✅ Updated CodeRecoder configuration')
except Exception as e:
    print(f'❌ Error updating configuration: {e}')
    sys.exit(1)
"
    else
        echo "➕ Adding CodeRecoder to existing configuration..."
        
        # Add CodeRecoder to existing configuration
        python3 -c "
import json
import sys

try:
    with open('$MCP_CONFIG_PATH', 'r') as f:
        config = json.load(f)
    
    if 'mcpServers' not in config:
        config['mcpServers'] = {}
    
    config['mcpServers']['coderecoder'] = {
        'command': 'node',
        'args': ['$CURRENT_DIR/dist/index.js']
    }
    
    with open('$MCP_CONFIG_PATH', 'w') as f:
        json.dump(config, f, indent=2)
    
    print('✅ Added CodeRecoder to MCP configuration')
except Exception as e:
    print(f'❌ Error updating configuration: {e}')
    sys.exit(1)
"
    fi
fi

echo ""
echo "📋 Updated configuration:"
cat "$MCP_CONFIG_PATH"
echo ""
echo "🔄 Please restart Cursor/Cline to load the new configuration"
echo ""
echo "🧪 Available CodeRecoder tools:"
echo "  - record_edit: Record code changes for version tracking"
echo "  - rollback_to_version: Undo changes to previous versions"
echo "  - list_history: View edit history"
echo "  - create_session: Start new editing sessions"
echo "  - get_current_session: Check current session info"
echo "  - get_diff: Generate differences between versions"
