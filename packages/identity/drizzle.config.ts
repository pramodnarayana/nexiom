import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env from apps/api
dotenv.config({ path: path.join(__dirname, "../../apps/api/.env") });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
