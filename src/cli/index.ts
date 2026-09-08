import { Argument, program } from "commander";
import { store } from "./commands/store.ts";
import { arcane } from "./commands/arcane.ts";

export const cli = program;

cli
	.enablePositionalOptions(true)
	.addCommand(store)
	.addCommand(arcane);