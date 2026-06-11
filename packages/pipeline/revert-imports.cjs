const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const replacements = [
  { from: /from "\.\.\/\.\.\/utils\.js"/g, to: 'from "../utils.js"' },
  { from: /from "\.\.\/\.\.\/index\.js"/g, to: 'from "../index.js"' },
  { from: /from "\.\.\/\.\.\/storage-resolver\//g, to: 'from "../storage-resolver/' },
  { from: /from "\.\.\/\.\.\/sharding\//g, to: 'from "../sharding/' },
];

walkDir('src', filePath => {
  if (filePath.endsWith('.ts') && !filePath.includes('pipeline-core.module.ts') && !filePath.includes('index.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    for (const r of replacements) {
      content = content.replace(r.from, r.to);
    }
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Reverted ${filePath}`);
    }
  }
});
