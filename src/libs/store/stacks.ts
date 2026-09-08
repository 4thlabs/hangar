import { access, constants } from "node:fs/promises"

/**
 * Check if a corresponding project exists and return it's path
 * @param project The project name (directory path)
 */
export const getStackPath = async (project: string) => {
  const paths = [
    `${process.env.HANGAR_DATA_DIR}/${project}`, 
    // Keeping for old architecture for now
    `${process.env.HANGAR_DATA_DIR}/apps/${project}`, 
    `${process.env.HANGAR_DATA_DIR}/stacks/${project}`
  ]

  const promises = paths.map((p) => {
    return access(p).then(() => p).catch(e => undefined)
  });

  return (await Promise.all(promises)).filter(i => i);
}