import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { authRelations } from './schemas/auth-schema.ts';

const databasePath = process.env.HANGAR_DB_HOST;

if (!databasePath) {
  throw new Error('HANGAR_DB_HOST is required');
}

export const db = drizzle({
  connection: {
    path: databasePath,
  },
  relations: { ...authRelations },
});
