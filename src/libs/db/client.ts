import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { authRelations } from './schemas/auth-schema';


export const db = drizzle({ 
  connection: { 
    path: process.env.HANGER_DB_HOST!
  },
  relations: {...authRelations},
});