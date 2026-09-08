import { config, getStackPath } from "#libs/store";
import { parallel, run, sequence } from "./runtime.ts";

// The order of execution for commands that need to be run in sequence: up and start are run in the order of the stacks, down and stop are run in reverse order.
const ORDER: Record<string, number> = { start: 1, restart: 1, down: -1, stop: -1 };

/**
 * Check if the args contains a detach mode
 * @param args Arguments passed through to docker compose
 */
const detached = (args: string[]) => args.includes("-d") || args.includes("--detach");

/**
 * Resolve a name to the stacks it covers: a global command covers every category,
 * a category its own stacks, anything else is taken as a stack name.
 * @global If true, the name is a global command and all stacks are returned
 * @param name A global command, a category or a stack name
 */
export const resolve = (global:boolean, name: string) => {
    const stacks = [...new Set(
        config.categories
            .filter(c => global || c.name === name)
            .flatMap(c => c.stacks)
    )];

    return stacks.length > 0 ? stacks : [name];
}

/**
 * Run docker compose against a stack of the store.
 * @param stack The stack name (directory path)
 * @param args Arguments passed through to docker compose
 */
export const execCompose = async (stack: string, ...args: string[]) => {
    const paths = await getStackPath(stack);

    if (paths.length === 0) {
        console.error(`Failed to find project: ${stack}`);
        return 1;
    }

    return run('docker',
        'compose',
        "--env-file",
        `${process.env.HOMELAB_STORE_DIR}/.env.global`,
        "-f",
        `${paths.at(0)!}/compose.yml`,
        ...args
    );
}

/**
 * Run docker compose on every category, a category or a stack
 * @param global If true, the name is a global command and all stacks are returned
 * @param name A global command, a category or a stack name
 * @param args Arguments passed through to docker compose
 */
export const execComposeOn = async (global: boolean, name: string, ...args: string[]) => {

    // `store up -d` / `store down` / `store pull`: no target, the command takes its place
    if (global) {
      args = [name, ...args];
    }
    
    // The direction of run, 1 sequence, -1 sequence reverse, 0 parallel 
    let dir = ORDER[args[0] as string] ?? 0;
    if (args[0] === "up" && detached(args)) {
        dir = 1;
    }

    const stacks = resolve(global, name);

    if (args[0] === "up" && !detached(args) && stacks.length > 1) {
        console.error("Non detached mode only authorised on a single stack");
        return 1;
    }

    if (dir != 0) {
        return await sequence(dir == 1 ? stacks : stacks.reverse(), execCompose, ...args);
    } else {
        return await parallel(stacks, execCompose, ...args);
    }
}