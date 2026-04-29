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

  // Print the ntfy url so the user can get push notifications anywhere
  console.log(`\x1b[32m[Push Notifications]\x1b[39m Subscribe to this URL on your phone to get alerts when Claude pauses:`);
  console.log(`\x1b[36mhttps://ntfy.sh/${config.ntfyTopic}\x1b[39m\n`);

  return config;
}
