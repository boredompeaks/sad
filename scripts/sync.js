const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'js');
const destDir = path.join(__dirname, '..', 'www', 'js');

console.log(`Syncing ${srcDir} to ${destDir}...`);

// Ensure destination exists
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// Simple recursive copy function
function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest);
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

copyRecursiveSync(srcDir, destDir);

// Sync chat.html to www/index.html
const srcHtml = path.join(__dirname, '..', 'chat.html');
const destHtml = path.join(__dirname, '..', 'www', 'index.html');
console.log(`Syncing ${srcHtml} to ${destHtml}...`);
fs.copyFileSync(srcHtml, destHtml);

console.log('✅ Sync complete.');
