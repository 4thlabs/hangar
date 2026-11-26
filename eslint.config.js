import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";

/**
 * Only the blank-line rules Prettier cannot hold: it keeps the blank lines it is given but never
 * adds one. Parsed with Babel, since typescript-eslint does not run on TypeScript 7.
 */
const parserFor = plugins => ({
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins } },
  },
});

const blankLines = [
  "error",
  { blankLine: "always", prev: "*", next: "return" },
  { blankLine: "always", prev: ["multiline-block-like", "multiline-expression"], next: "*" },
  { blankLine: "always", prev: ["const", "let"], next: "*" },
  { blankLine: "any", prev: ["singleline-const", "singleline-let"], next: ["singleline-const", "singleline-let"] },
];

export default [
  // `web/src` is the Rust server's page, which follows the same rules.
  {
    ignores: [
      "src/modules/common/ui/**",
      "src/app/pages.gen.ts",
      "web/src/modules/common/ui/**",
      "web/src/libs/api/generated.ts",
    ],
  },
  {
    files: ["src/**/*.ts", "web/src/**/*.ts"],
    languageOptions: parserFor(["typescript"]),
  },
  {
    files: ["src/**/*.tsx", "web/src/**/*.tsx"],
    languageOptions: parserFor(["typescript", "jsx"]),
  },
  {
    files: ["src/**/*.{ts,tsx}", "web/src/**/*.{ts,tsx}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/padding-line-between-statements": blankLines,
    },
  },
];
