import { Pool } from "pg";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// Load environment variables from the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env") });

// Safety gate: prevent running against production
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
  console.error("Error: Seeding is not allowed in production. Set ALLOW_SEED=true to override.");
  process.exit(1);
}

const TENANT_DATABASE_URL = process.env.TENANT_DATABASE_URL;

if (!TENANT_DATABASE_URL) {
  console.error("Error: TENANT_DATABASE_URL is not defined in the environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString: TENANT_DATABASE_URL });

const carrierMapping = JSON.stringify([
  { src: "$.displayName", dest: "$.DisplayName", required: true },
  { src: "$.displayName", dest: "$.CompanyName", required: true },
  { src: "$.tp.mcNumber", dest: "$.GivenName" },
  
  // BillAddr from remitTo
  { src: "$.remitTo.country", dest: "$.BillAddr.Country" },
  { src: "$.remitTo.displayName", dest: "$.BillAddr.Line1" },
  { src: "$.remitTo.street", dest: "$.BillAddr.Line2" },
  { src: "$.remitTo.city", dest: "$.BillAddr.City" },
  { src: "$.remitTo.state", dest: "$.BillAddr.CountrySubDivisionCode" },
  { src: "$.remitTo.postalCode", dest: "$.BillAddr.PostalCode" },
  
  // ShipAddr from carrier
  { src: "$.billingCity", dest: "$.ShipAddr.City" },
  { src: "$.billingState", dest: "$.ShipAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.ShipAddr.PostalCode" },
  
  // Phones
  { src: "$.phone", dest: "$.PrimaryPhone.FreeFormNumber" },
  { src: "$.fax", dest: "$.Fax.FreeFormNumber" }
]);

const defaultMapping = JSON.stringify([
  { src: "$.displayName", dest: "$.DisplayName", required: true },
  { src: "$.displayName", dest: "$.CompanyName", required: true },
  
  // Address mapping - standard (own address)
  { src: "$.billingCountry", dest: "$.BillAddr.Country" },
  { src: "$.displayName", dest: "$.BillAddr.Line1" },
  { src: "$.billingStreet", dest: "$.BillAddr.Line2" },
  { src: "$.billingCity", dest: "$.BillAddr.City" },
  { src: "$.billingState", dest: "$.BillAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.BillAddr.PostalCode" },
  
  // Ship address mapping
  { src: "$.billingCity", dest: "$.ShipAddr.City" },
  { src: "$.billingState", dest: "$.ShipAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.ShipAddr.PostalCode" },
  
  // Phones
  { src: "$.phone", dest: "$.PrimaryPhone.FreeFormNumber" },
  { src: "$.fax", dest: "$.Fax.FreeFormNumber" }
]);

async function run() {
  try {
    console.log(`Seeding mappings in public schema...`);

    // TMS_CARRIER -> QuickBooks Vendor (Uses RemitTo + TP)
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('45375f51-0a16-4df7-9228-161e80fc9fc7', 'TMS_CARRIER', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [carrierMapping]);

    // TMS_VENDOR -> QuickBooks Vendor
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('45375f51-0a16-4df7-9228-161e80fc9fc7', 'TMS_VENDOR', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [defaultMapping]);

    // TMS_FACTORING -> QuickBooks Vendor
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('45375f51-0a16-4df7-9228-161e80fc9fc7', 'TMS_FACTORING', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [defaultMapping]);

    // TMS_CUSTOMER -> QuickBooks Customer
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('8136aef7-cbc7-47ed-9b29-3f4980737cfd', 'TMS_CUSTOMER', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [defaultMapping]);

    console.log("Mappings seeded successfully in global DB.");
    console.log("\nTriggering registry replication outbox so tenant DBs receive the updates...");
    execSync(`node ${path.resolve(__dirname, "seed-registry-outbox.mjs")}`, { stdio: "inherit" });
  } catch(e) {
    console.error("Error seeding mappings:", e);
    throw e;
  } finally {
    await pool.end();
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
