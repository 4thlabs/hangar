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

/**
 * ADR 0002, rule 1: no class made only of static members. What has no state is module functions and consts; what has
 * state or dependencies is a class created with `new`. A class that extends another, as `ApiError extends Error`, is
 * left alone.
 */
const staticOnlyClass = {
  selector: "ClassDeclaration[superClass=null] > ClassBody:not(:has(> [static=false]))",
  message:
    "A class made only of static members: write module functions and consts, or a class with instances (ADR 0002, decision 7).",
};

/**
 * ADR 0002, rule 4: a module's root `.ts` is its domain, pure and tested without rendering. It imports no React, no
 * icons, no TanStack, only the types, enums and classes of `#libs/api` (its names that start with a capital: orval's
 * hooks, fetchers and keys, and the transport's functions, start with a lowercase letter), and only types from a
 * module's `api/`, `hooks/`, `components/` or `ui/`, by `#modules/...` or a relative path. The specifiers are
 * `#modules/...`, which a gitignore-style `group` would read as a comment: they are written as `regex`.
 */
const rootModuleImports = [
  "error",
  {
    patterns: [
      {
        regex: "^react(-dom)?(/.*)?$",
        message: "A module's root .ts renders nothing: no React (ADR 0002, decision 1).",
      },
      { regex: "^lucide-react$", message: "A module's root .ts renders nothing: no icons (ADR 0002, decision 1)." },
      { regex: "^@tanstack/", message: "A module's root .ts is pure: no TanStack (ADR 0002, decision 1)." },
      {
        regex: "^#libs/api$",
        allowImportNamePattern: "^[A-Z]",
        message: "A module's root .ts takes only the types and enums of #libs/api (ADR 0002, decision 1).",
      },
      {
        regex: "^(#modules/[^/]+|\\.)/(api|hooks|components|ui)/",
        allowTypeImports: true,
        message: "A module's root .ts takes only types from api/, hooks/, components/ and ui/ (ADR 0002, decision 1).",
      },
    ],
  },
];

/** Rule 4 for `import()`, which `no-restricted-imports` does not read: no module's `api/`, `hooks/` or `components/`. */
const rootModuleDynamicImport = {
  selector: "ImportExpression[source.value=/^(#modules\\/[^\\/]+|\\.)\\/(api|hooks|components|ui)\\//]",
  message: "A module's root .ts loads nothing of api/, hooks/, components/ or ui/ (ADR 0002, decision 1).",
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
    rules: { ...pageRules, "no-restricted-syntax": ["error", staticOnlyClass] },
  },
  {
    files: ["web/src/modules/*/*.ts"],
    ignores: ["web/src/modules/*/*.test.ts"],
    // Flat config does not merge a rule's options across blocks: rule 1's selector is given again beside rule 4's.
    rules: {
      "no-restricted-imports": rootModuleImports,
      "no-restricted-syntax": ["error", staticOnlyClass, rootModuleDynamicImport],
    },
  },
];
