import path from "node:path";
import { HangarRuntimeError } from "../hangar-error.ts";
import { Hangar } from "../hangar.ts";
import { exists, parallel, sequence } from "./utils.ts";

// The order of execution for commands that need to be run in sequence: up and start are run in the order of the stacks, down and stop are run in reverse order.
const ORDER: Record<string, number> = { start: 1, restart: 1, down: -1, stop: -1 };

/** Store global commands */
const GLOBALS: Array<string> = ["up", "down", "pull"];

/**
 * Check if the args contains a detach mode
 * @param args Arguments passed through to docker compose
 */
const detached = (args: string[]) => args.includes("-d") || args.includes("--detach");

/**
 * Run docker compose against a stack
 * @param stack The stack name (directory path)
 * @param args Arguments passed through to docker compose
 */
export const execCompose = async (hangar: Hangar, stack: string, ...args: string[]) => {
    const compose = path.join(hangar.store.installedPath, stack, "compose.yml");
    
    if (!await exists(compose)) {
        throw new HangarRuntimeError(1, "`Failed to find project: ${stack}`")
    }

    return hangar.runtime.run("docker",
        "compose",
        "--env-file",
        `${hangar.store.installedPath}/.env.global`,
        "-f",
        compose,
        ...args
    );
}

/**
 * Run docker compose on every category, a category or a stack
 * @param global If true, the name is a global command and all stacks are returned
 * @param name A global command, a category or a stack name
 * @param args Arguments passed through to docker compose
 */
export const execComposeOn = async (hangar: Hangar, name: string, ...args: string[]) => {

    // `store up -d` / `store down` / `store pull`: no target, the command takes its place
    if (GLOBALS.includes(name)) {
      args = [name, ...args];
    }
    
    // The direction of run, 1 sequence, -1 sequence reverse, 0 parallel 
    let dir = ORDER[args[0] as string] ?? 0;
    if (args[0] === "up" && detached(args)) {
        dir = 1;
    }

    const stacks = hangar.store.resolve(name);

    if (args[0] === "up" && !detached(args) && stacks.length > 1) {
        console.error("Non detached mode only authorised on a single stack");
        return 1;
    }

    if (dir != 0) {
        return await sequence(hangar, dir == 1 ? stacks : stacks.reverse(), execCompose, ...args);
    } else {
        return await parallel(hangar, stacks, execCompose, ...args);
    }
}