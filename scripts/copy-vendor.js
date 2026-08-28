const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');
fs.mkdirSync(vendorDir, { recursive: true });

const files = [
  ['marked/lib/marked.umd.js', 'marked.min.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
];

for (const [src, destName] of files) {
  const srcPath = path.join(root, 'node_modules', src);
  const destPath = path.join(vendorDir, destName);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copiado ${src} -> public/vendor/${destName}`);
  } else {
    console.warn(`Aviso: no se encontro ${src}, revisa la version del paquete.`);
  }
}
