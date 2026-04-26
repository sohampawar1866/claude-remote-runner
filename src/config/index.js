import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';


const CONFIG_DIR = path.join(os.homedir(), '.remote-claude');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function getOrGenerateConfig() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  let config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  }

  if (!config.pairingToken) {
    config.pairingToken = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    
    console.log('\x1b[35m====================================================\x1b[39m');
    console.log('\x1b[36m[remote-claude]\x1b[39m First run detected!');
    console.log('\x1b[36m[remote-claude]\x1b[39m Generated local configuration.');
    console.log('\x1b[35m====================================================\x1b[39m\n');
  }

  // Derive ntfy topic from token so it's impossible to guess
  config.ntfyTopic = crypto.createHash('sha256').update(config.pairingToken).digest('hex').substring(0, 32);

  // DEV MODE ONLY: Print the ntfy url so the developer can test push notifications immediately
  console.log(`\x1b[33m[DEV] Subscribe to this ntfy topic to see push alerts:\x1b[39m`);
  console.log(`\x1b[33mhttps://ntfy.sh/${config.ntfyTopic}\x1b[39m\n`);

  return config;
}
