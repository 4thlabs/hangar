import { parse } from "dotenv";
import { CORE_SCHEMA, defineMappingTag, defineScalarTag, defineSequenceTag, loadAll } from "js-yaml";
import { HangarError } from "./hangar-error.ts";

/** Matches every local tag (`!secret`, `!include`): the check reads the syntax, never what a tag means. */
const anyLocalTag = { matchByTagPrefix: true, identify: () => false } as const;

/**
 * The schema the YAML check parses with: the default one, plus any local tag on any kind of node, as
 * Home Assistant's `!secret db_password` or `!include automations.yaml`.
 */
const TolerantSchema = CORE_SCHEMA.withTags(
  defineScalarTag("!", { ...anyLocalTag, resolve: source => source }),
  defineSequenceTag<unknown[]>("!", {
    ...anyLocalTag,
    create: () => [],
    addItem: (items, item) => void items.push(item),
  }),
  defineMappingTag<Map<unknown, unknown>>("!", {
    ...anyLocalTag,
    create: () => new Map(),
    addPair: (pairs, key, value) => {
      pairs.set(key, value);

      return "";
    },
    has: (pairs, key) => pairs.has(key),
    keys: pairs => pairs.keys(),
    get: (pairs, key) => pairs.get(key),
  }),
);

/**
 * The syntax check an app file gets before it is written, chosen by its extension. The root
 * `compose.yml` is not checked here: `docker compose config` validates it, which needs the runtime.
 */
export class AppFileSyntax {
  private static readonly Yaml = /\.ya?ml$/;

  private static readonly Env = /\.env$/;

  /**
   * Throws a {@link HangarError} saying what is wrong when `source` does not parse as its
   * extension says. A file with any other extension is accepted as is.
   * @param relativePath The file's path inside its app folder, named in the error
   */
  static check(relativePath: string, source: string) {
    if (AppFileSyntax.Yaml.test(relativePath)) {
      AppFileSyntax.checkYaml(relativePath, source);
    }

    if (AppFileSyntax.Env.test(relativePath)) {
      AppFileSyntax.checkEnv(relativePath, source);
    }
  }

  /** Several documents (`---`) and local tags are valid YAML, which `load` alone would refuse. */
  private static checkYaml(relativePath: string, source: string) {
    try {
      loadAll(source, { filename: relativePath, schema: TolerantSchema });
    } catch (error) {
      throw new HangarError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * dotenv never rejects a file: it skips every line it cannot read, so a typo silently drops a
   * variable. Each line must then be blank, a comment, declare a variable, or be one of the lines
   * dotenv took into a quoted multi-line value (the closing one with its quote).
   */
  private static checkEnv(relativePath: string, source: string) {
    const multiLineValues = Object.values(parse(source)).filter(value => value.includes("\n"));
    const valueLines = new Set(multiLineValues.flatMap(value => value.split("\n")));

    for (const [index, line] of source.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      const isBlankOrComment = trimmed === "" || trimmed.startsWith("#");
      const isDeclaration = Object.keys(parse(line)).length > 0;
      const isInsideValue = valueLines.has(line) || valueLines.has(line.trimEnd().replace(/["'`]$/, ""));

      if (!isBlankOrComment && !isDeclaration && !isInsideValue) {
        throw new HangarError(`${relativePath}, line ${index + 1}: expected VARIABLE=value, got "${trimmed}"`);
      }
    }
  }
}
