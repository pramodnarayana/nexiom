import { Pool } from "pg";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables from the monorepo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, "../.env") });

const TENANT_DATABASE_URL = process.env.TENANT_DATABASE_URL;

if (!TENANT_DATABASE_URL) {
  console.error("Error: TENANT_DATABASE_URL is not defined in the environment.");
  process.exit(1);
}

const pool = new Pool({ connectionString: TENANT_DATABASE_URL });

const vendorMapping = JSON.stringify([
  { src: "$.name", dest: "$.DisplayName", required: true },
  { src: "$.name", dest: "$.CompanyName", required: true },
  { src: "$.GivenName", dest: "$.GivenName" },
  { src: "$.billingStreet", dest: "$.BillAddr.Line1" },
  { src: "$.billingCity", dest: "$.BillAddr.City" },
  { src: "$.billingStateCode", dest: "$.BillAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.BillAddr.PostalCode" },
  { src: "$.billingCountryCode", dest: "$.BillAddr.Country" },
  { src: "$.phone", dest: "$.PrimaryPhone.FreeFormNumber" },
  { src: "$.email", dest: "$.PrimaryEmailAddr.Address" },
  { src: "$.fax", dest: "$.Fax.FreeFormNumber" }
]);

const customerMapping = JSON.stringify([
  { src: "$.name", dest: "$.DisplayName", required: true },
  { src: "$.name", dest: "$.CompanyName", required: true },
  { src: "$.billingStreet", dest: "$.BillAddr.Line1" },
  { src: "$.billingCity", dest: "$.BillAddr.City" },
  { src: "$.billingStateCode", dest: "$.BillAddr.CountrySubDivisionCode" },
  { src: "$.billingPostalCode", dest: "$.BillAddr.PostalCode" },
  { src: "$.billingCountryCode", dest: "$.BillAddr.Country" },
  { src: "$.phone", dest: "$.PrimaryPhone.FreeFormNumber" },
  { src: "$.email", dest: "$.PrimaryEmailAddr.Address" }
]);

async function run() {
  try {
    console.log(`Seeding mappings in public schema...`);

    // TMS_VENDOR -> QuickBooks Vendor
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('45375f51-0a16-4df7-9228-161e80fc9fc7', 'TMS_VENDOR', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [vendorMapping]);

    // TMS_FACTOR -> QuickBooks Vendor
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('45375f51-0a16-4df7-9228-161e80fc9fc7', 'TMS_FACTOR', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [vendorMapping]);

    // TMS_CUSTOMER -> QuickBooks Customer
    await pool.query(`
      INSERT INTO public.field_mapping (stitch_id, source_canonical, mapping_rules)
      VALUES ('8136aef7-cbc7-47ed-9b29-3f4980737cfd', 'TMS_CUSTOMER', $1::jsonb)
      ON CONFLICT (stitch_id, source_canonical) DO UPDATE SET mapping_rules = $1::jsonb
    `, [customerMapping]);

    console.log("Mappings seeded successfully.");
  } catch(e) {
    console.error("Error seeding mappings:", e);
  }
  process.exit(0);
}

run().catch(e => { 
  console.error(e); 
  process.exit(1); 
});
