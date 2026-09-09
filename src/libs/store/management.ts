import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { logger } from "#libs/logs";
import { exists, resolve, run } from "#libs/runtime";
import { config } from "./config.ts";

const getStorePaths = () => {
  const dataPath = path.resolve(process.env.HANGAR_DATA_DIR);

  return {
    dataPath,
    storePath: path.join(dataPath, "store"),
    installedPath: path.join(dataPath, "app-installed"),
  };
};

export const isStoreInstalled = async () => {
  const { storePath } = getStorePaths();
  return exists(path.join(storePath, ".git"));
};

const linkStack = async (stack: string, storePath: string, installedPath: string) => {
  const source = path.join(storePath, stack);
  const destination = path.join(installedPath, stack);

  if (!(await exists(source)) || (await exists(destination))) {
    return 0;
  }

  try {
    await symlink(source, destination, "dir");
    return 0;
  } catch (error) {
    logger.error({ error, stack }, "Failed to link installed stack");
    return 1;
  }
};

const linkConfiguredStacks = async () => {
  const { storePath, installedPath } = getStorePaths();
  await mkdir(installedPath, { recursive: true });

  const codes = await Promise.all(resolve(true, "").map(stack => linkStack(stack, storePath, installedPath)));
  return codes.find(code => code !== 0) ?? 0;
};

/** Install the store repository and link all configured stacks. */
export const install = async () => {
  const { dataPath, storePath } = getStorePaths();
  await mkdir(dataPath, { recursive: true });

  if (!(await isStoreInstalled())) {
    const code = await run("git", "clone", "--", config.store, storePath);

    if (code !== 0) {
      return code;
    }
  }

  return linkConfiguredStacks();
};

/** Update the installed store without overwriting local changes, then reconcile stack links. */
export const update = async () => {
  if (!(await isStoreInstalled())) {
    return 1;
  }

  const { storePath } = getStorePaths();
  const code = await run("git", "-C", storePath, "pull", "--ff-only");

  if (code !== 0) {
    return code;
  }

  return linkConfiguredStacks();
};
