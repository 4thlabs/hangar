import { env } from "#libs/env";
import { Hangar, HangarError, HangarRuntimeError } from "#libs/hangar";
import { logger } from "#libs/logs";

/**
 * Builds the CLI's Hangar instance and installs the SIGINT handler.
 *
 * Memoized and lazy: both command trees ask for it, building it reads the
 * store's hangar.yml, and `--help` must not touch the disk at all.
 */
let instance: Promise<Hangar> | undefined;

export const createHangar = () => {
  instance ??= Hangar.create(env.HANGAR_STORE_URL, env.HANGAR_DATA_DIR).then(async hangar => {
    hangar.runtime.signals();

    // The web app loads the categories through store.refresh(); the CLI has no
    // such boot step, and `store up` / `arcane sync` are useless without them.
    await hangar.store.config.load();

    return hangar;
  });

  return instance;
};

/**
 * Runs a command body and maps its outcome to a process exit code.
 *
 * Wrap the whole body, Hangar construction included: a bad config must report
 * one line and an exit code, not an unhandled rejection and a stack dump.
 */
export const run = async (body: (hangar: Hangar) => Promise<number | unknown>) => {
  try {
    const hangar = await createHangar();
    const result = await body(hangar);

    // A body may report its own exit code (syncTags does); otherwise success.
    return typeof result === "number" ? result : 0;
  } catch (error: unknown) {
    // Config and runtime failures are expected operator errors: report the
    // message. Anything else is a real defect, so keep the stack.
    if (error instanceof HangarError) logger.error(error.message);
    else logger.error("Command failed", { error });

    return error instanceof HangarRuntimeError ? error.code : 1;
  }
};
