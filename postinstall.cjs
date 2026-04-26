const fs = require('fs');
const path = require('path');

function fixNodePtyPermissions() {
  try {
    const nodePtyIndex = require.resolve('node-pty');
    const nodePtyDir = path.dirname(path.dirname(nodePtyIndex)); 
    
    const prebuildsDir = path.join(nodePtyDir, 'prebuilds');
    if (fs.existsSync(prebuildsDir)) {
      const platforms = fs.readdirSync(prebuildsDir);
      for (const platform of platforms) {
        const helperPath = path.join(prebuildsDir, platform, 'spawn-helper');
        if (fs.existsSync(helperPath)) {
          const stat = fs.statSync(helperPath);
          // If not executable
          if ((stat.mode & 0o111) === 0) {
            fs.chmodSync(helperPath, 0o755);
            console.log(`[remote-claude] Fixed execution permissions for ${helperPath}`);
          }
        }
      }
    }
  } catch (e) {
    console.error("[remote-claude] Note: Could not fix node-pty permissions automatically.");
  }
}

fixNodePtyPermissions();
