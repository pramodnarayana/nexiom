import type { Config } from 'drizzle-kit';

export default {
    schema: './src/schema',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL || 'postgres://admin:password123@localhost:5432/nexiom_master',
    },
} satisfies Config;
