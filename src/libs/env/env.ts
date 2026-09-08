import "dotenv/config";
import * as z from "zod";
 
const envVariables = z.object({
  HANGAR_CONFIG_FILE: z.string().min(1),
  HANGAR_DATA_DIR: z.string().min(1)
});
 
envVariables.parse(process.env);
 
declare global {
  namespace NodeJS {
    interface ProcessEnv extends z.infer<typeof envVariables> {}
  }
}