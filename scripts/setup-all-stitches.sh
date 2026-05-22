#!/usr/bin/env bash
set -e

# Automatically find the first Salesforce and QuickBooks connections in the global DB
echo "Finding active connections..."
SF_ID=$(node -e "
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\"SELECT id FROM data_source WHERE app_name = 'salesforce' LIMIT 1\").then(res => {
  console.log(res.rows[0]?.id || '');
  pool.end();
});
")

QB_ID=$(node -e "
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\"SELECT id FROM data_source WHERE app_name = 'quickbooks' LIMIT 1\").then(res => {
  console.log(res.rows[0]?.id || '');
  pool.end();
});
")

if [ -z "$SF_ID" ] || [ -z "$QB_ID" ]; then
  echo "Error: Could not find active Salesforce and QuickBooks connections. Did you create them in the UI?"
  exit 1
fi

echo "Found Salesforce: $SF_ID"
echo "Found QuickBooks: $QB_ID"

echo "------------------------------------------------------"
echo "Provisioning Factoring Stitch..."
node scripts/create-stitch.mjs -n "Salesforce to QuickBooks (Factoring)" -s "$SF_ID" -d "$QB_ID" -so "Account" -do "Vendor" -c "TMS_FACTORING" -f "./scripts/mappings/factoring.json"

echo "------------------------------------------------------"
echo "Provisioning Carrier Stitch..."
node scripts/create-stitch.mjs -n "Salesforce to QuickBooks (Carrier)" -s "$SF_ID" -d "$QB_ID" -so "Account" -do "Vendor" -c "TMS_CARRIER" -f "./scripts/mappings/carrier.json"

echo "------------------------------------------------------"
echo "Provisioning Customer Stitch..."
node scripts/create-stitch.mjs -n "Salesforce to QuickBooks (Customer)" -s "$SF_ID" -d "$QB_ID" -so "Account" -do "Customer" -c "TMS_CUSTOMER" -f "./scripts/mappings/customer.json"

echo "------------------------------------------------------"
echo "All 3 stitches (Factoring, Carrier, Customer) have been successfully created!"
