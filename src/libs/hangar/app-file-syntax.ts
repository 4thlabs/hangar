import { parse } from "dotenv";
import { load } from "js-yaml";
import { HangarError } from "./hangar-error.ts";

/**
 * The syntax check an app file gets before it is written, chosen by its extension. The root
 * `compose.yml` is not checked here: `docker compose config` validates it, which needs the runtime.
 */
export class AppFileSyntax {
  private static readonly Yaml = /\.ya?ml$/;

  private static readonly Env = /\.env$/;

  /** The quotes dotenv lets a value span several lines with */
  private static readonly Quotes = ["'", '"', "`"];

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

  private static checkYaml(relativePath: string, source: string) {
    try {
      load(source, { filename: relativePath });
    } catch (error) {
      throw new HangarError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * dotenv never rejects a file: it skips every line it cannot read, so a typo silently drops a
   * variable. Each line must then be blank, a comment, the rest of a quoted multi-line value, or
   * declare a variable dotenv reads.
   */
  private static checkEnv(relativePath: string, source: string) {
    let openQuote: string | undefined;

    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (openQuote !== undefined) {
        if (line.includes(openQuote)) {
          openQuote = undefined;
        }

        continue;
      }

      const trimmed = line.trim();

      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }

      if (Object.keys(parse(line)).length === 0) {
        throw new HangarError(`${relativePath}, line ${index + 1}: expected VARIABLE=value, got "${trimmed}"`);
      }

      openQuote = AppFileSyntax.unclosedQuote(line);
    }
  }

  /** The quote a value opens on this line without closing it, so the lines after it belong to it. */
  private static unclosedQuote(line: string) {
    const value = line.slice(line.indexOf("=") + 1).trimStart();
    const quote = AppFileSyntax.Quotes.find(candidate => value.startsWith(candidate));

    if (quote === undefined || value.slice(1).includes(quote)) {
      return undefined;
    }

    return quote;
  }
}
