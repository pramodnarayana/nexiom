// Re-export global schema definitions so Drizzle provisions them as replica tables in the tenant databases
export { uiWorkspaces, uiWorkspaceDataSources } from '../global/workspace.js';
export { dataSources } from '../global/data-sources.js';
export { integrationStitches, fieldMappings } from '../global/stitches.js';
