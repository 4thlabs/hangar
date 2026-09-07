import "dotenv/config";
import * as z from "zod";
 
const envVariables = z.object({
  HOMELAB_STORE_DIR: z.string().min(1),
  HOMELAB_CONFIG_FILE: z.string().min(1)
});
 
envVariables.parse(process.env);
 
declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envVariables> {}
  }
}