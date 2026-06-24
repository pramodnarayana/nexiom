// Re-export global schema definitions so Drizzle provisions them as replica tables in the tenant databases
export { uiWorkspaces } from '../shared/workspace.js';
export { dataSources } from '../shared/data-sources.js';
export { integrationStitches, fieldMappings } from '../shared/stitches.js';
