import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'; 
import { db } from '#libs/db';

/**
 * Better Auth configuration for the Hangar project.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { 
    provider: "sqlite", // or "pg" or "mysql"
  }), 
  //... the rest of your config
});