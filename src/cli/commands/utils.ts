import "#libs/env";
import { Hangar } from "#libs/hangar";

export const createHangar = async () => {
  return await Hangar.create(process.env.HANGAR_CONFIG_FILE, process.env.HANGAR_DATA_DIR);
}