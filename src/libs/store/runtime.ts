import { ChildProcess, spawn } from "node:child_process";
import { getStackPath } from "./stacks.ts";
import { config } from "./config.ts";

// The order of execution for commands that need to be run in sequence: up and start are run in the order of the stacks, down and stop are run in reverse order.
const ORDER: Record<string, number> = { start: 1, restart: 1, down: -1, stop: -1 };

let interrupted = false;
const childs: Set<ChildProcess> = new Set();

process.on("SIGINT", () => {
    interrupted = true;
    if (childs.size === 0) process.exit(130);
});

/**
 * Spawn a command, inheriting stdio, and resolve with its exit code.
 * @param command The executable to run
 * @param args Arguments passed to the executable
 */
export const run = (command: string, ...args: string[]) => {
    return new Promise<number>((resolve) => {
        // Interrupted: don't start anything new, the caller stops on a non-zero code.
        if (interrupted) {
            return resolve(130);
        }

        const child = spawn(command, args, { 
            stdio: ['inherit', 'inherit', 'inherit'] 
        });

        childs.add(child)

        child.on('error', (err) => {
            childs.delete(child);
            console.error(`Failed to run ${command}: ${err.message}`);
            resolve(1);
        });

        // A signal means the child was killed (Ctrl-C during an up): that is a failure.
        child.on('close', (code, signal) => {
            childs.delete(child);
            resolve(signal ? 130 : code ?? 1);
        });
    });
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
 * Runs a function (child process) in sequence, stopping at the first failure
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The exit code of the first failure, 0 otherwise
 */
const sequence = async (stacks: string[], run: Function, ...args: string[]) => {
    for (const s of stacks) {
        const code = await run(s, ...args);
        if (code != 0) {
            console.log(interrupted ? `Interrupted on: ${s}, stopping ...` : `Stack failed: ${s}, stopping ...`);
            return code;
        }
    }

    return 0;
}

/**
 * Run a function (child process) in parallel
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The first non zero exit code, 0 otherwise
 */
const parallel = async (stacks: string[], run: Function, ...args: string[]) => {
    const codes: number[] = await Promise.all(stacks.map(s => run(s, ...args)));

    return codes.find(c => c != 0) ?? 0;
}

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
 * Run docker compose on every category, a category or a stack
 * @param global If true, the name is a global command and all stacks are returned
 * @param name A global command, a category or a stack name
 * @param args Arguments passed through to docker compose
 */
export const execOn = async (global: boolean, name: string, ...args: string[]) => {

    // `store up -d` / `store down` / `store pull`: no target, the command takes its place
    if (global) {
      args = [name, ...args];
    }
    
    // The direction of run, 1 sequence, -1 sequence reverse, 0 parallel 
    let dir = ORDER[args[0]] ?? 0;
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
