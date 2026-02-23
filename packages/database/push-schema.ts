import { Client } from 'pg';

async function main() {
    const client = new Client({
        connectionString: 'postgres://admin:password123@localhost:5432/nexiom_master'
    });

    await client.connect();
    console.log('Connected to PG');

    const query = `
    CREATE TABLE IF NOT EXISTS "app_credential" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "app_name" varchar(100) NOT NULL,
        "client_id" text NOT NULL,
        "encrypted_client_secret" text NOT NULL,
        "setup_metadata" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );

    DO $$ 
    BEGIN 
        IF NOT EXISTS (
            SELECT 1 
            FROM information_schema.table_constraints 
            WHERE constraint_name = 'app_credential_provider_id_provider_id_fk'
        ) THEN
            ALTER TABLE "app_credential" ADD CONSTRAINT "app_credential_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE no action;
        END IF; 
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS "tenant_app_credential_unique_idx" ON "app_credential" USING btree ("tenant_id","app_name");
    `;

    try {
        await client.query(query);
        console.log('Successfully created app_credential table and constraints');
    } catch (e) {
        console.error('Error executing query', e);
    } finally {
        await client.end();
    }
}

main();
