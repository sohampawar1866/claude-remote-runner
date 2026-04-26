#!/usr/bin/env bash

# Claude Remote Runner - Single Command Installer
# Usage: curl -sL https://raw.githubusercontent.com/sohampawar1866/remote-claude/main/install.sh | bash

set -e

echo "🚀 Installing Claude Remote Runner..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js (>= 16) and try again."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

echo "📦 Running npm install -g @sohampawar1866/remote-claude..."
# Try to install globally
if ! npm install -g @sohampawar1866/remote-claude; then
    echo "⚠️  Global installation failed. Attempting with sudo..."
    sudo npm install -g @sohampawar1866/remote-claude
fi

echo "✅ Installation complete."
echo "You can now run 'remote-claude --help' or 'remote-claude start' to begin."
