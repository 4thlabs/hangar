import { logger } from "#libs/logs";
import { Argument, Command } from "commander";
import { createHangar } from "./utils.ts";

export const store = new Command("store");

const hangar = await createHangar();

const trailingArguments = new Argument("[args...]", "docker compose commands");

const exitCode = async <T>(p: Promise<T>) => {
  return p
    .then(() => 0)
    .catch(ex => {
      logger.error(ex);
      return ex.code ?? 1;
    });
};

store
  .description("commands for store management")
  .passThroughOptions(true)
  .argument("<project>", "project to interract with")
  .addArgument(trailingArguments)
  .action(async (project: string, args: string[]) => {
    process.exitCode = await exitCode(hangar.store.compose(project, ...args));
  });

store
  .command("update")
  .description("Installs and links the app store")
  .action(async () => {
    process.exitCode = await exitCode(hangar.store.update(true));
  });

store
  .command("up")
  .description("Up all configured projects")
  .requiredOption("-d, --detach", "Run containers in the background")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await exitCode(hangar.store.compose("up", "-d", ...args));
  });

store
  .command("down")
  .description("Down all configured projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await exitCode(hangar.store.compose("down", ...args));
  });

store
  .command("ls")
  .description("View running compose projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await exitCode(hangar.runtime.run("docker", "compose", "ls", ...args));
  });
