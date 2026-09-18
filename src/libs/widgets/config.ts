import * as z from "zod";

/**
 * The dashboard, as the store declares it in `hangar.yml`.
 *
 * Kept free of JSX on purpose: `HangarConfig` validates the `widgets:` section
 * at load, and that module is also imported by the CLI, which must not pull
 * React in to parse a YAML file. The components live in `registry.ts`.
 */

/** Grid columns a widget can be placed in. */
export type DashboardColumn = 1 | 2 | 3;

const columnSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** `owner/repo` — the only form the GitHub releases API takes. */
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo");

export const widgetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clock"), column: columnSchema }),
  z.object({ type: z.literal("docker-general-stats"), column: columnSchema }),
  z.object({ type: z.literal("arcane-general-stats"), column: columnSchema }),
  z.object({ type: z.literal("frigate-events"), column: columnSchema }),
  z.object({
    type: z.literal("github-releases"),
    column: columnSchema,
    repositories: z.array(repositorySchema).min(1),
  }),
]);

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/**
 * The dashboard a store gets when its `hangar.yml` declares no `widgets:`.
 * An existing install keeps the dashboard it had before the section existed.
 */
export const defaultWidgets: readonly WidgetConfig[] = [
  { type: "clock", column: 1 },
  { type: "docker-general-stats", column: 1 },
  { type: "frigate-events", column: 3 },
];
