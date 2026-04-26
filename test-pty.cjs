const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');

function findClaudeBinary() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'claude.cmd' : 'claude';
  
  const envPaths = (process.env.PATH || '').split(isWin ? ';' : ':');
  const home = os.homedir();
  
  let commonPaths = [];
  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    commonPaths = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'Programs', 'claude'),
      path.join(home, 'AppData', 'Roaming', 'npm'),
      'C:\\Windows\\System32',
      'C:\\Windows',
    ];
  } else {
    commonPaths = [
      path.join(home, '.local', 'bin'),
      path.join(home, '.npm-global', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ];
  }
  
  const allPaths = [...new Set([...envPaths, ...commonPaths])].filter(Boolean);
  
  for (const dir of allPaths) {
    try {
      const fullPath = path.join(dir, binName);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    } catch (e) {}
  }
  return null;
}

const claudePath = findClaudeBinary();
console.log('Found claude at:', claudePath);

if (claudePath) {
  try {
    const p = pty.spawn(claudePath, ['--version'], { env: process.env });
    p.onData(d => console.log('PTY:', d));
  } catch(e) {
    console.log('PTY Error:', e);
  }
}
