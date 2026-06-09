/**
 * Thrown by Target Builders (L4) when required relational dependencies are missing
 * from the database, preventing the construction of the final canonical payload graph.
 */
export class DependenciesMissingError extends Error {
    constructor(
        public readonly missingDependencies: Array<{ entityType: string; sourceId: string }>
    ) {
        super(`Missing dependencies: ${missingDependencies.map((d) => `${d.entityType}:${d.sourceId}`).join(', ')}`);
        this.name = 'DependenciesMissingError';
    }
}
