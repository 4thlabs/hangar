import { getProjects, getTags, syncTags } from "#libs/api/arcane";
import { Command } from "commander";

export const arcane = new Command("arcane")

arcane
  .description("commands for arcane management");
    
arcane
  .command("sync")
  .description("Sync arcane tags based on homelab definition")
  .action(async () => {
      process.exitCode = await syncTags();
  })