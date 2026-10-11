import { Argument, Command } from "commander";
import { run } from "./utils.ts";

export const swarm = new Command("swarm");

const trailingArguments = new Argument("[args...]", "docker stack arguments");

swarm
  .description("commands for the apps that run in the swarm")
  .passThroughOptions(true)
  .argument("<target>", "an app, a category, or deploy / rm for every swarm: app")
  .addArgument(trailingArguments)
  .action(async (target: string, args: string[]) => {
    process.exitCode = await run(hangar => hangar.store.stack(target, args));
  });

swarm
  .command("ls")
  .description("View the stacks running in the swarm")
  .addArgument(trailingArguments)
  .action(async (args: string[]) => {
    process.exitCode = await run(hangar => hangar.runtime.run("docker", ["stack", "ls", ...args]));
  });
