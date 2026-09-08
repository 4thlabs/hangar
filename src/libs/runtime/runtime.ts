import { ChildProcess, spawn } from "node:child_process";
import { access } from "node:fs/promises";

let interrupted = false;
const childs: Set<ChildProcess> = new Set();

process.on("SIGINT", () => {
    interrupted = true;
    if (childs.size === 0) process.exit(130);
});

/**
 * Spawn a command, inheriting stdio, and resolve with its exit code.
 * TODO: Output streaming mode
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
 * Check the existance of a file/path
 * @param path The path to check
 */
export const exists = async (path: string) => {
    return await access(path).then(() => true).catch(e => false);
}

/**
 * Runs a function (child process) in sequence, stopping at the first failure
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The exit code of the first failure, 0 otherwise
 */
export const sequence = async (stacks: string[], run: Function, ...args: string[]) => {
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
export const parallel = async (stacks: string[], run: Function, ...args: string[]) => {
    const codes: number[] = await Promise.all(stacks.map(s => run(s, ...args)));

    return codes.find(c => c != 0) ?? 0;
}
