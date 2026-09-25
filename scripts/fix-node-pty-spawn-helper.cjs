// node-pty publishes its macOS spawn-helper prebuilds without the execute bit. Packaged apps use those
// prebuilds, so every terminal would fail with "posix_spawnp failed" until the bit is restored.
const fs = require('node:fs');
const path = require('node:path');

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');
if (fs.existsSync(prebuilds)) {
  for (const platform of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, platform, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}
