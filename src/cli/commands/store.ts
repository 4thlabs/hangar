import { Argument, Command } from "commander";
import { run } from "./utils.ts";

export const store = new Command("store");

const trailingArguments = new Argument("[args...]", "docker compose commands");

store
  .description("commands for store management")
  .passThroughOptions(true)
  .argument("<project>", "project to interract with")
  .addArgument(trailingArguments)
  .action(async (project: string, args: string[]) => {
    process.exitCode = await run(hangar => hangar.store.compose(project, ...args));
  });

store
  .command("update")
  .description("Installs and links the app store")
  .action(async () => {
    process.exitCode = await run(hangar => hangar.store.update(true));
  });

store
  .command("up")
  .description("Up all configured projects (always detached)")
  .option("-d, --detach", "Run containers in the background (default)")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await run(hangar => hangar.store.compose("up", "-d", ...args));
  });

store
  .command("down")
  .description("Down all configured projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await run(hangar => hangar.store.compose("down", ...args));
  });

store
  .command("ls")
  .description("View running compose projects")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await run(hangar => hangar.runtime.run("docker", "compose", "ls", ...args));
  });
