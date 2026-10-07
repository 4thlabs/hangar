import { env } from "#libs/env";
import { Hangar, HangarError, HangarRuntimeError } from "#libs/hangar";
import { logger } from "#libs/logs";

let instance: Promise<Hangar> | undefined;

/**
 * Builds the CLI's Hangar instance and installs the SIGINT handler.
 * Memoized and lazy: building it reads the store's hangar.yml, and `--help` must not touch the disk.
 */
export const createHangar = () => {
  instance ??= (async () => {
    const hangar = Hangar.create(env.HANGAR_STORE_URL, env.HANGAR_DATA_DIR);

    hangar.runtime.signals();

    // The CLI has no boot step: load the categories `store up` needs.
    await hangar.store.config.load();

    return hangar;
  })();

  return instance;
};

/**
 * Runs a command body and maps its outcome to a process exit code.
 * Wraps Hangar construction too: a bad config reports one line and an exit code, not a stack dump.
 */
export const run = async (body: (hangar: Hangar) => Promise<unknown>) => {
  try {
    await body(await createHangar());

    return 0;
  } catch (error: unknown) {
    // Config and runtime failures are operator errors: report the message. Anything else is a defect: keep the stack.
    if (error instanceof HangarError) {
      logger.error(error.message);
    } else {
      logger.error("Command failed", { error });
    }

    return error instanceof HangarRuntimeError ? error.code : 1;
  }
};
