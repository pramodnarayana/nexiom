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
  // Ports / Adapters / Interfaces are now in ../shared
  { from: /from (['"])\.\/ports\//g, to: 'from $1../shared/ports/' },
  { from: /from (['"])\.\/adapters\//g, to: 'from $1../shared/adapters/' },
  { from: /from (['"])\.\/interfaces\//g, to: 'from $1../shared/interfaces/' },
  { from: /from (['"])\.\/outbox\.utils\.js\1/g, to: 'from $1../shared/outbox.utils.js$1' },
  { from: /from (['"])\.\.\/ports\//g, to: 'from $1../../shared/ports/' },

  // Services that used to be adjacent but are now in other folders
  // In delivery:
  { from: /from "\.\/gem-hydration\.service\.js"/g, to: 'from "./gem-hydration.service.js"' }, // Same folder
  
  // Upper level modules: storage-resolver, sharding, index, utils
  // If a file is in src/context/file.ts, it was previously src/orchestrator/file.ts
  // Previously it did `import ... from "../utils.js"`, now it should be `import ... from "../../utils.js"`
  { from: /from (['"])\.\.\/utils\.js\1/g, to: 'from $1../../utils.js$1' },
  { from: /from (['"])\.\.\/index\.js\1/g, to: 'from $1../../index.js$1' },
  { from: /from (['"])\.\.\/storage-resolver\//g, to: 'from $1../../storage-resolver/' },
  { from: /from (['"])\.\.\/sharding\//g, to: 'from $1../../sharding/' },
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
      console.log(`Updated ${filePath}`);
    }
  }
});
