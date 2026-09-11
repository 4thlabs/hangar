import { hangar } from "#libs/hangar";
import { logger } from "#libs/logs";
import { Argument, Command } from "commander";

export const store = new Command("store");

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
    //process.exitCode = await execComposeOn(false, project, ...args);
  });

store
  .command("install")
  .description("Installs and links the app store")
  .action(async () => {
    process.exitCode = await exitCode(hangar.store.install());
  });

store
  .command("up")
  .description("Up all configured projects")
  .requiredOption("-d, --detach", "Run containers in the background")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    //process.exitCode = await execComposeOn(true, "up", "-d", ...args);
  });

store
  .command("down")
  .description("Down all configured projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    //process.exitCode = await execComposeOn(true, "down", ...args).then(() => 0).catch(e => e.code);
  });

store
  .command("ls")
  .description("View running compose projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    //process.exitCode = await run("docker", "compose", "ls");
  });
