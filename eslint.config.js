import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * The blank-line rules Prettier cannot hold, since it keeps the blank lines it is given but never
 * adds one, and for `web/` the rules of `docs/web/CODING_RULES.md` that need no types. Parsed with
 * Babel, since typescript-eslint does not run on TypeScript 7: the rules that read types are
 * oxlint's, in `web/.oxlintrc.json`.
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

/**
 * The rules of hooks and the React compiler's, which work on Babel's tree, and the core rules that
 * need no types. `no-unused-vars` is oxlint's: the core rule sees neither a name used in JSX nor
 * one used only as a type.
 */
const pageRules = {
  ...reactHooks.configs["recommended-latest"].rules,
  curly: ["error", "all"],
  eqeqeq: ["error", "always", { null: "ignore" }],
  "no-console": ["error", { allow: ["warn", "error"] }],
  "no-implicit-coercion": "error",
  "no-param-reassign": "error",
  "prefer-const": "error",
};

export default [
  // `web/src` is the Rust server's page, which follows the same rules, and its own in the last block.
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
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: pageRules,
  },
];
