import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config();

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './d1/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./.data/local.db',
  },
});
