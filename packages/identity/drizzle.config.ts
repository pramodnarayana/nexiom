import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import * as path from "path";

// Load env from apps/api first, then local fallback
dotenv.config({ path: path.join(__dirname, "../../apps/api/.env") });
if (!process.env.DATABASE_URL) {
  dotenv.config(); // Fallback to local .env
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined in environment variables");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
