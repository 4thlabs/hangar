import { env } from "#libs/env";
import { Hangar } from "../hangar.ts";

async function createHangar() {
  const hangar = await Hangar.create(env.HANGAR_STORE_URL, env.HANGAR_DATA_DIR);
  await hangar.store.refresh();
  return hangar;
}

// Reused across HMR reloads, otherwise dev opens a new handle
const globalForHangar = globalThis as unknown as { hangar?: Hangar };

export const hangar = globalForHangar.hangar ?? (await createHangar());

globalForHangar.hangar = hangar;
