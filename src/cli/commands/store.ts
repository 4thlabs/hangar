import { execOn, run } from "#libs/store";
import { Argument, Command } from "commander";

export const store = new Command("store");

const trailingArguments = new Argument("[args...]", "docker compose commands");

store
    .description("commands for store management")
    .passThroughOptions(true)
    .argument("<project>", "project to interract with")
    .addArgument(trailingArguments)
    .action(async (project: string, args: string[]) => {
        process.exitCode = await execOn(false, project, ...args);
    });

store
    .command("up")
    .description("Up all configured projects")
    .requiredOption("-d, --detach", "Run containers in the background")
    .addArgument(trailingArguments)
    .action(async (args: string[]) => {
        process.exitCode = await execOn(true, "up", "-d", ...args);
    });

store
    .command("down")
    .description("Down all configured projects")
    .addArgument(trailingArguments)
    .action(async (args: string[]) => {
        process.exitCode = await execOn(true, "down", ...args);
    });

store
    .command("ls")
    .description("View running compose projects")
    .addArgument(trailingArguments)
    .action(async (args: string[]) => {
        process.exitCode = await run("docker", "compose", "ls");
    });