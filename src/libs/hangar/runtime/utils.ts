import { stat } from "node:fs/promises";

/**
 * Check the existance of a file/path
 * @param path The path to check
 */
export const exists = async (path: string) => {
  return stat(path)
    .then(() => true)
    .catch(() => false);
};
