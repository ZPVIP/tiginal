// electron-builder afterSign hook. Without a Developer ID the app is left with only the linker signature on its
// executable, and macOS reports a downloaded copy as damaged. An ad-hoc signature over the whole bundle makes
// macOS show the ordinary unidentified-developer prompt, which users can approve in System Settings.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
