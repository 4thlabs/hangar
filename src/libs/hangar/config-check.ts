import path from "node:path";
import { AppFiles } from "./app-files.ts";
import type { Category, Config } from "./hangar-config.ts";

/**
 * The checks on `hangar.yml` the schema cannot make, because they need the store on disk. A save is
 * refused on any of them; a load only reports them, so a file that loads today keeps the server booting.
 */
export class ConfigCheck {
  /** The clone's `store/` folder, one folder per app */
  private readonly appsPath: string;

  /** The words a category may not take, or the CLI could not address it */
  private readonly cliWords: readonly string[];

  /**
   * @param appsPath The clone's `store/` folder
   * @param cliWords The words a category may not take, `HangarStore.CliWords`
   */
  constructor(appsPath: string, cliWords: readonly string[]) {
    this.appsPath = appsPath;
    this.cliWords = cliWords;
  }

  /**
   * Every problem in the categories, then in the `swarm:` list, one sentence each, in file order; empty
   * when there is none.
   * @param config The categories and the swarm list, as parsed
   * @param appIds The apps of the store, as `HangarStore` lists them: one rule for what an app is
   */
  async problems(config: Pick<Config, "categories" | "swarm">, appIds: ReadonlySet<string>): Promise<string[]> {
    return [...this.categoryProblems(config.categories, appIds), ...(await this.swarmProblems(config.swarm, appIds))];
  }

  /** An app declared twice, an id with no app behind it, a category the CLI could not address. */
  private categoryProblems(categories: readonly Category[], appIds: ReadonlySet<string>) {
    const problems: string[] = [];
    const declaredIn = new Map<string, string>();

    for (const category of categories) {
      problems.push(...this.nameProblems(category.name, appIds));

      for (const entry of category.stacks) {
        const firstCategory = declaredIn.get(entry.id);

        if (firstCategory !== undefined) {
          problems.push(`${entry.id} is declared twice, in ${firstCategory} and ${category.name}`);
          continue;
        }

        declaredIn.set(entry.id, category.name);

        if (!appIds.has(entry.id)) {
          problems.push(ConfigCheck.unknownApp(entry.id));
        }
      }
    }

    return problems;
  }

  /** An app listed twice, an id with no app behind it, an app that cannot run in the swarm. */
  private async swarmProblems(swarm: readonly string[], appIds: ReadonlySet<string>) {
    const problems: string[] = [];
    const listed = new Set<string>();

    for (const app of swarm) {
      if (listed.has(app)) {
        problems.push(`${app} is listed twice under swarm`);
        continue;
      }

      listed.add(app);

      if (!appIds.has(app)) {
        problems.push(ConfigCheck.unknownApp(app));
        continue;
      }

      if (!(await AppFiles.isSwarmReady(path.join(this.appsPath, app)))) {
        problems.push(`${app} is listed under swarm but has no ${AppFiles.SwarmFile}`);
      }
    }

    return problems;
  }

  private static unknownApp(id: string) {
    return `${id} is not an app of the store: no store/${id}/${AppFiles.ComposeFile}`;
  }

  /** Why a category name could not be addressed from the CLI, if it cannot. */
  private nameProblems(name: string, appIds: ReadonlySet<string>) {
    if (this.cliWords.includes(name)) {
      return [`The category ${name} is named like a CLI command`];
    }

    if (appIds.has(name)) {
      return [`The category ${name} is named like an app of the store`];
    }

    return [];
  }
}
