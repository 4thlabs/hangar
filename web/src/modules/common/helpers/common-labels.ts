import type { ComposeCase, ComposeOperation } from "#modules/common/helpers/compose-actions.ts";
import { m } from "#paraglide/messages.js";

/** The words of each value `common` shows a label of, by the type that lists them: a new value is a type error here. */
export const commonLabels = {
  /** What each compose command is called. */
  operations: {
    up: m.common_operations_up,
    restart: m.common_operations_restart,
    down: m.common_operations_down,
  } satisfies Record<ComposeOperation, () => string>,
  /** What each compose command did to an app, once it ran. */
  outcomes: {
    up: m.common_compose_outcome_started,
    upPull: m.common_compose_outcome_pulled,
    upRecreate: m.common_compose_outcome_recreated,
    upPullRecreate: m.common_compose_outcome_pulled_recreated,
    restart: m.common_compose_outcome_restarted,
    down: m.common_compose_outcome_removed,
  } satisfies Record<ComposeCase, (params: { project: string }) => string>,
  /** What Up is called with its options, by what they do. */
  combined: {
    upPull: m.common_compose_label_update,
    upRecreate: m.common_compose_label_recreate,
    upPullRecreate: m.common_compose_label_update_recreate,
  } satisfies Record<Exclude<ComposeCase, ComposeOperation>, () => string>,
};
