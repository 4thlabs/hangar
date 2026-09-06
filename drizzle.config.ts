import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/drizzle',
  schema: ['./src/libs/db/schemas/auth-schema.ts','./src/libs/db/schemas/schema.ts'],
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.HANGER_DB_HOST!,
  },
});