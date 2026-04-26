const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

(async () => {
  const pngPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(pngPath)) {
    console.error('icon.png not found:', pngPath);
    process.exit(1);
  }
  const buf = await pngToIco(pngPath);
  fs.writeFileSync(icoPath, buf);
  console.log('Created:', icoPath);
})();
