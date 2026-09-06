import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/drizzle',
  schema: ['./src/libs/db/auth-schema.ts','./src/libs/db/schema.ts'],
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.HANGER_DB_HOST!,
  },
});