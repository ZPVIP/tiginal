// electron-builder afterSign hook.
// Signs the bundle with an Apple Development / Developer ID certificate from Keychain if available,
// preserving macOS TCC permissions (Screen/System Audio Recording, Microphone) across reinstalls.
// Falls back to ad-hoc signing ('-') if no certificate is installed in Keychain.
const { execFileSync, execSync } = require('node:child_process');
const path = require('node:path');

function detectSigningIdentity() {
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;
  if (process.env.CSC_NAME) return process.env.CSC_NAME;
  try {
    const output = execSync('security find-identity -v -p codesigning', { encoding: 'utf8' });
    const matches = [...output.matchAll(/"([^"]+)"/g)].map(m => m[1]);

    // Priority 1: Official Developer ID Application (for distribution)
    const devId = matches.find(id => id.startsWith('Developer ID Application:'));
    if (devId) return devId;

    // Priority 2: Personal Apple Development certificate matching current user
    const personalDev = matches.find(
      id => id.startsWith('Apple Development:') && (id.includes('zpadmin') || id.includes('pengzhang'))
    );
    if (personalDev) return personalDev;

    // Priority 3: Any Apple Development certificate
    const anyDev = matches.find(id => id.startsWith('Apple Development:'));
    if (anyDev) return anyDev;

    // Priority 4: Any valid codesigning identity
    if (matches.length > 0) return matches[0];
  } catch {
    // Keychain query failed or not on macOS
  }
  return '-';
}

exports.default = async function signMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const identity = detectSigningIdentity();
  console.log(`[signMac] Code-signing "${app}" with identity: "${identity}"`);
  execFileSync('codesign', ['--force', '--deep', '--sign', identity, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
