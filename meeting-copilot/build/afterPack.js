// electron-builder hook: stamps the app icon + version info into the .exe.
// (electron-builder's own step for this needs a Windows symlink privilege that many machines lack,
//  so it is disabled in package.json and done here with the rcedit package instead.)
const path = require('path');
const rcedit = require('rcedit');

exports.default = async function afterPack(context) {
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  const version = context.packager.appInfo.version;
  await rcedit(exe, {
    icon: path.join(context.packager.projectDir, 'build', 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'Meeting Copilot',
      FileDescription: 'Meeting Copilot',
      InternalName: 'Meeting Copilot',
      OriginalFilename: 'Meeting Copilot.exe',
    },
  });
};
