import { program } from "commander";
import { store } from "./commands/store.ts";
import { swarm } from "./commands/swarm.ts";

export const cli = program;

cli.enablePositionalOptions(true).addCommand(store).addCommand(swarm);
