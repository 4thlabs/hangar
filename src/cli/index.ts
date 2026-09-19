import { program } from "commander";
import { store } from "./commands/store.ts";

export const cli = program;

cli.enablePositionalOptions(true).addCommand(store);
