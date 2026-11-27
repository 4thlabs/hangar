import { readdirSync } from "node:fs";
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
 * ADR 0002, rule 2: orval's `use*` hooks are not imported outside `#libs/api`. A component or a hook calls
 * `useQuery(xQueries.y())` and `useMutation(xMutations.z())`, on the options of its module's `api/`, which say a read's
 * policy and what a change makes stale. Held on `modules/`, `routes/` and the wiring at `src/`.
 */
const orvalHooks = {
  regex: "^#libs/api$",
  importNamePattern: "^use[A-Z]",
  message:
    "orval's hooks stay in #libs/api: call useQuery or useMutation on the options of the module's api/ (ADR 0002, decision 1).",
};

/**
 * #214: the words are read through Paraglide's `m`, from `#paraglide/messages.js`, which `messages/en.json` compiles
 * into. Nothing imports the catalog itself, whose ids `tsc` would not check.
 */
const catalogFile = {
  regex: "(^|/)messages/[^/]+\\.json$",
  message: "Read the words with m, from #paraglide/messages.js, never from messages/en.json (#214).",
};

/** Rule 2 too: no `..` segment in a route or the wiring, so that every import is a `#...` specifier the rules read. */
const parentSegment = {
  regex: "(^|/)\\.\\.(/|$)",
  message:
    "Import with #modules/..., #routes/... or #..., not a .. segment, so that the rules see every import (ADR 0002, decision 10).",
};

/**
 * ADR 0002, rule 3: a module's `api/` holds the options of its reads and changes, the keys, and what a change makes
 * stale. It imports no React and no package of React's, and nothing of a module's `hooks/`, `components/` or `ui/`:
 * what renders or holds state takes its options, not the other way.
 */
const apiPatterns = [
  { regex: "^react(-[^/]+)?(/|$)", message: "A module's api/ renders nothing: no React (ADR 0002, decision 1)." },
  {
    regex: "^(lucide-react(/|$)|@base-ui/)",
    message: "A module's api/ renders nothing: no icons or components (ADR 0002, decision 1).",
  },
  {
    regex: "^(#modules/[^/]+|\\.)/(hooks|components|ui)/",
    message:
      "A module's api/ takes nothing of hooks/, components/ or ui/: they take its options (ADR 0002, decision 1).",
  },
];

/** Rule 3 for `import()`, which `no-restricted-imports` does not read: no module's `hooks/`, `components/` or `ui/`. */
const apiDynamicImport = {
  selector: importOf("^(#modules\\/[^\\/]+|\\.)\\/(hooks|components|ui)\\/"),
  message: "A module's api/ loads nothing of hooks/, components/ or ui/ (ADR 0002, decision 1).",
};

/**
 * ADR 0002, rule 4: a module's `helpers/` are its domain, pure and tested without rendering. They import no React and no
 * package of React's (`react-*`, `lucide-react`, `@base-ui/`), no TanStack, only the types, enums and classes of
 * `#libs/api` (its names that start with a capital: orval's hooks, fetchers and keys, and the transport's functions,
 * start with a lowercase letter), and only types from a module's `api/`, `hooks/`, `components/` or `ui/`. Paraglide's
 * `m`, from `#paraglide/messages.js`, is allowed (#214): the words are plain functions. The specifiers are
 * `#modules/...`, which a gitignore-style `group` would read as a comment: they are written as `regex`.
 */
const helperPatterns = [
  {
    regex: "^react(-[^/]+)?(/|$)",
    message: "A module's helpers render nothing: no React (ADR 0002, decision 1).",
  },
  {
    regex: "^(lucide-react(/|$)|@base-ui/)",
    message: "A module's helpers render nothing: no icons or components (ADR 0002, decision 1).",
  },
  { regex: "^@tanstack/", message: "A module's helpers are pure: no TanStack (ADR 0002, decision 1)." },
  {
    regex: "^#libs/api$",
    allowImportNamePattern: "^[A-Z]",
    message: "A module's helpers take only the types and enums of #libs/api (ADR 0002, decision 1).",
  },
  {
    // `./hooks/` is what a file at a module's root would write: `../` is refused in every module.
    regex: "^(#modules/[^/]+|\\.)/(api|hooks|components|ui)/",
    allowTypeImports: true,
    message: "A module's helpers take only types from api/, hooks/, components/ and ui/ (ADR 0002, decision 1).",
  },
];

/**
 * The selector of an `import()` whose specifier `pattern` matches, a regex with its `/` escaped: a string, or a
 * template with no expression in it, which is a string too. One with an expression is not known before it runs.
 */
function importOf(pattern) {
  return [
    `ImportExpression[source.value=/${pattern}/]`,
    `ImportExpression[source.type="TemplateLiteral"][source.expressions.length=0][source.quasis.0.value.cooked=/${pattern}/]`,
  ].join(", ");
}

/**
 * Rule 4 for `import()`, which `no-restricted-imports` does not read: no module's `api/`, `hooks/`, `components/` or
 * `ui/`.
 */
const helperDynamicImport = {
  selector: importOf("^(#modules\\/[^\\/]+|\\.)\\/(api|hooks|components|ui)\\/"),
  message: "A module's helpers load nothing of api/, hooks/, components/ or ui/ (ADR 0002, decision 1).",
};

/** The modules of the page, each a folder of `web/src/modules`: a new one is held by the rules below as it is added. */
const pageModules = readdirSync(new URL("web/src/modules/", import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

/**
 * #207, ADR 0002's decision 6: a module imports only `common`, `#libs/...`, its own files and packages; `common`, only
 * itself. The routes compose the modules, and nothing of `#routes/`, the wiring or another module is imported from
 * one. Paraglide's output, `#paraglide/`, is shared by all (#214). A test may take `#mock/`, the page's test double. A
 * `..` segment is refused wherever it is (`../`, `./../`, `#modules/apps/../store/`), so that every import names its
 * module.
 */
function modulePatterns(module, { tests }) {
  const allowed = ["libs/", "paraglide/", "modules/common/", `modules/${module}/`, ...(tests ? ["mock/"] : [])];

  return [
    orvalHooks,
    catalogFile,
    {
      regex: `^#(?!${allowed.join("|")})`,
      message: `A module imports only common, #libs and #paraglide: ${module} may not import another module, a route or the wiring (ADR 0002, decision 6). Compose them in a route.`,
    },
    {
      regex: "(^|/)\\.\\.(/|$)",
      message:
        "In a module, import with #modules/..., so that the rules see which module a file is in (ADR 0002, decision 6).",
    },
  ];
}

/** The isolation of a module for `import()`, which `no-restricted-imports` does not read. */
function moduleDynamicImport(module) {
  const allowed = ["libs", "paraglide", "modules\\/common", `modules\\/${module}`]
    .map(prefix => `${prefix}\\/`)
    .join("|");

  return {
    selector: importOf(`^#(?!${allowed})|(^|\\/)\\.\\.(\\/|$)`),
    message: `A module loads only common, #libs and #paraglide: ${module} may not load another module, a route or the wiring (ADR 0002, decision 6).`,
  };
}

/**
 * For each module: its isolation and rule 2 on every file, its tests' `#mock/` allowed, rule 3 on its `api/` and rule 4
 * on its helpers beside it.
 */
const moduleBlocks = pageModules.flatMap(module => [
  {
    files: [`web/src/modules/${module}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": ["error", { patterns: modulePatterns(module, { tests: false }) }],
      "no-restricted-syntax": ["error", staticOnlyClass, moduleDynamicImport(module)],
    },
  },
  {
    files: [`web/src/modules/${module}/**/*.test.{ts,tsx}`],
    rules: { "no-restricted-imports": ["error", { patterns: modulePatterns(module, { tests: true }) }] },
  },
  {
    files: [`web/src/modules/${module}/api/**/*.{ts,tsx}`],
    ignores: [`web/src/modules/${module}/api/**/*.test.{ts,tsx}`],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...modulePatterns(module, { tests: false }), ...apiPatterns] }],
      "no-restricted-syntax": ["error", staticOnlyClass, moduleDynamicImport(module), apiDynamicImport],
    },
  },
  {
    files: [`web/src/modules/${module}/helpers/**/*.{ts,tsx}`],
    ignores: [`web/src/modules/${module}/helpers/**/*.test.{ts,tsx}`],
    // Flat config does not merge a rule's options across blocks: the isolation and rule 1 are given again here.
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...modulePatterns(module, { tests: false }), ...helperPatterns] },
      ],
      "no-restricted-syntax": ["error", staticOnlyClass, moduleDynamicImport(module), helperDynamicImport],
    },
  },
]);

/**
 * #207: a module holds a folder per level (`components/`, `hooks/`, `api/`, `helpers/`), and no file of its own: its
 * words are in `messages/en.json` since #214. Any file directly under it is refused, whatever it holds.
 */
const looseModuleFile = {
  selector: "Program",
  message:
    "A file directly under a module: put it in its components/, hooks/, api/ or helpers/ (ADR 0002, decision 6). Its words go in messages/en.json (#214).",
};

/** #207: a file directly under `web/src/modules/` belongs to no module, so no module block would hold its imports. */
const looseModulesFile = {
  selector: "Program",
  message:
    "A file directly under modules/ is in no module: put it in the module it belongs to, or in common if two modules share it (ADR 0002, decision 6).",
};

export default [
  // `web/src` is the Rust server's page, which follows the same rules, and its own in the last block.
  {
    ignores: [
      "src/modules/common/ui/**",
      "src/app/pages.gen.ts",
      "web/src/modules/common/ui/**",
      "web/src/libs/api/generated.ts",
      "web/src/libs/api/generated.msw.ts",
      "web/src/routeTree.gen.ts",
      "web/src/paraglide/**",
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
    // The catalog for every file, `libs/` and `mock/` included: the blocks below repeat it with their own patterns.
    rules: {
      ...pageRules,
      "no-restricted-imports": ["error", { patterns: [catalogFile] }],
      "no-restricted-syntax": ["error", staticOnlyClass],
    },
  },
  ...moduleBlocks,
  // Rule 2 on the routes and the wiring, which compose the modules: no orval hook, no `..` segment, no catalog.
  {
    files: ["web/src/routes/**/*.{ts,tsx}", "web/src/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", { patterns: [orvalHooks, parentSegment, catalogFile] }] },
  },
  {
    files: ["web/src/modules/*/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", staticOnlyClass, looseModuleFile] },
  },
  {
    files: ["web/src/modules/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": ["error", staticOnlyClass, looseModulesFile] },
  },
];
