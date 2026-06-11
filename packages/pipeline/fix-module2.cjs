const fs = require('fs');
let content = fs.readFileSync('src/pipeline-core.module.ts', 'utf8');

content = content.replace(/from "\.\.\/storage-resolver\//g, 'from "./storage-resolver/');
content = content.replace(/from "\.\.\/sharding\//g, 'from "./sharding/');

fs.writeFileSync('src/pipeline-core.module.ts', content, 'utf8');
