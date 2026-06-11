const fs = require('fs');
let content = fs.readFileSync('src/pipeline-core.module.ts', 'utf8');

content = content.replace(/from "\.\/replica\.service\.js"/g, 'from "./replication/replica.service.js"');
content = content.replace(/from "\.\/normalization\.service\.js"/g, 'from "./normalization/normalization.service.js"');
content = content.replace(/from "\.\/target-builder\.service\.js"/g, 'from "./fanout/target-builder.service.js"');
content = content.replace(/from "\.\/fanout-router\.service\.js"/g, 'from "./fanout/fanout-router.service.js"');
content = content.replace(/from "\.\/fanout-batch-processor\.js"/g, 'from "./fanout/fanout-batch-processor.js"');
content = content.replace(/from "\.\/routing-decision\.engine\.js"/g, 'from "./fanout/routing-decision.engine.js"');

content = content.replace(/from "\.\/ports\//g, 'from "./shared/ports/');
content = content.replace(/from "\.\/adapters\//g, 'from "./shared/adapters/');

content = content.replace(/from "\.\/delivery\.service\.js"/g, 'from "./delivery/delivery.service.js"');
content = content.replace(/from "\.\/piece-outbound\.dispatcher\.js"/g, 'from "./delivery/piece-outbound.dispatcher.js"');
content = content.replace(/from "\.\/delivery-retry\.service\.js"/g, 'from "./delivery/delivery-retry.service.js"');
content = content.replace(/from "\.\/gem-hydration\.service\.js"/g, 'from "./delivery/gem-hydration.service.js"');
content = content.replace(/from "\.\/registry-replication\.service\.js"/g, 'from "./replication/registry-replication.service.js"');
content = content.replace(/from "\.\/dependency-sweeper\.service\.js"/g, 'from "./normalization/dependency-sweeper.service.js"');

content = content.replace(/from "\.\/use-cases\/claim-delivery\.use-case\.js"/g, 'from "./delivery/use-cases/claim-delivery.use-case.js"');

fs.writeFileSync('src/pipeline-core.module.ts', content, 'utf8');
