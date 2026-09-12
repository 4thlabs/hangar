import { Hangar } from "./hangar";

async function createHangarForServer() {
  const hangar = await Hangar.create(process.env.HANGAR_CONFIG_FILE, process.env.HANGAR_DATA_DIR)
  await hangar.store.refresh();
  return hangar;
}

// Reused across HMR reloads, otherwise dev opens a new handle
const globalForHangar = globalThis as unknown as { hangar?: Hangar };

export const hangar = globalForHangar.hangar ?? await createHangarForServer();

globalForHangar.hangar = hangar;