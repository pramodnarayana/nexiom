import { AbilityBuilder, type CreateAbility, createMongoAbility, type MongoAbility, type MongoQuery, type ExtractSubjectType } from '@casl/ability';


export type Actions = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type UserSubject = { __typename: 'User'; role?: string };
export type Subjects = 'User' | UserSubject | 'all';

export type AppAccessControl = MongoAbility<[Actions, Subjects]>;

export const createAppAccessControl = createMongoAbility as CreateAbility<AppAccessControl>;

interface CaslRule {
    action: string;
    subject: string;
    conditions?: MongoQuery;
}

export const defineAccessControlFor = (user: { permissions?: (string | object)[] }) => {
    const { can, build } = new AbilityBuilder(createAppAccessControl);

    // Pure Database-Driven ABAC
    // All permissions, including Owner/Admin power, must come from the user's permission list.
    // Ensure the database is seeded with { resource: 'all', action: 'manage' } for the Owner role.

    // Dynamic Permission Hydration (ABAC)
    if (user.permissions) {
        user.permissions.forEach((p: string | object) => {
            let rule: CaslRule | null = null;

            if (typeof p === 'string') {
                // Simple PBAC: "resource:action" (backward compatibility)
                const trimmed = p.trim();
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed && typeof parsed === 'object' && 'action' in parsed && 'subject' in parsed) {
                            rule = parsed as CaslRule;
                        } else {
                            console.error('Invalid permission rule shape', parsed);
                        }
                    } catch {
                        console.error('Failed to parse permission rule', p);
                    }
                } else {
                    const [resource, action] = p.split(':');
                    if (resource && action) {
                        rule = { action, subject: resource };
                    }
                }
            } else {
                rule = p as CaslRule;
            }

            if (rule) {
                // Map DB Resource names (often lowercase/plural) to CASL Subjects (often PascalCase)
                // In our case, 'User' is already correct in some places, but let's be safe.
                // ideally backend sends "User", "Organization" etc.
                const subject = rule.subject as Subjects;

                if (rule.conditions) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    can(rule.action as Actions, subject as any, rule.conditions);
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    can(rule.action as Actions, subject as any);
                }
            }
        });
    }

    return build({
        // Read https://casl.js.org/v6/en/guide/subject-type-detection
        detectSubjectType: (item) => {
            if (typeof item === 'string') return item;
            const typeName = (item as Record<string, unknown>).__typename;
            if (typeof typeName !== 'string') {
                console.warn('Subject missing __typename, cannot determine type', item);
                // Return a non-existent subject so no rules match
                return '__unknown__' as ExtractSubjectType<Subjects>;
            }
            return typeName as ExtractSubjectType<Subjects>;
        }
    });
};
