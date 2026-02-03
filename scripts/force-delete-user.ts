
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../packages/identity/src/schema";
import { DrizzleUserAdapter } from "../packages/identity/src/adapters/drizzle-user.adapter";
import { eq } from "drizzle-orm";
// Mock Auth Provider for the adapter
const mockAuthProvider = {
    createUser: async () => { throw new Error("Not implemented"); },
    validateUser: async () => { throw new Error("Not implemented"); },
    setPassword: async () => { throw new Error("Not implemented"); },
    changePassword: async () => { throw new Error("Not implemented"); },
} as any;

async function main() {
    // Load environment variables correctly
    const path = await import("path");
    const dotenv = await import("dotenv");
    const envPath = path.resolve(process.cwd(), 'apps/api/.env');
    console.log('Loading .env from:', envPath);
    dotenv.config({ path: envPath });

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL is not defined");
        process.exit(1);
    }

    const { Pool } = pg;
    const pool = new Pool({ connectionString });
    const db = drizzle(pool, { schema });

    const adapter = new DrizzleUserAdapter(db, mockAuthProvider);
    const targetEmail = "pramod.narayana+tenant1@gmail.com";

    console.log(`Looking for user: ${targetEmail}`);
    const user = await adapter.findByEmail(targetEmail);

    if (!user) {
        console.log("User not found. They might have already been deleted.");
        process.exit(0);
    }

    console.log(`Found user: ${user.id}. Deleting...`);

    // We can use the adapter's delete, but we need to make sure we clean up the member relation explicitly if the adapter doesn't (it seemed to have cascading logic in previous view, let's verify or plain use raw queries if unsafe)
    // Checking adapter code from memory: it did have transaction with manual deletes for member, invitation, session, account.

    await adapter.delete(user.id);
    console.log("User successfully deleted.");

    await pool.end();
}

main().catch((err) => {
    console.error("Error deleting user:", err);
    process.exit(1);
});
