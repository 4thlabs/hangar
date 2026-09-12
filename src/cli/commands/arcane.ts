import { Command } from "commander";
import { syncTags } from "../../libs/api/arcane/management.ts";
import { run } from "./utils.ts";

export const arcane = new Command("arcane").description("commands for arcane management");

arcane
  .command("sync")
  .description("Sync arcane tags based on homelab definition")
  .action(async () => {
    process.exitCode = await run(syncTags);
  });
