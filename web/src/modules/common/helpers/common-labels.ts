import type { ComposeOperation } from "#modules/common/helpers/compose-actions.ts";
import { m } from "#paraglide/messages.js";

/** The words of each value `common` shows a label of, by the type that lists them: a new value is a type error here. */
export const commonLabels = {
  /** What each compose command is called. */
  operations: {
    up: m.common_operations_up,
    restart: m.common_operations_restart,
    down: m.common_operations_down,
  } satisfies Record<ComposeOperation, () => string>,
  /** What each run without options did to an app, completing "<app> was …". */
  outcomes: {
    up: m.common_outcomes_up,
    restart: m.common_outcomes_restart,
    down: m.common_outcomes_down,
  } satisfies Record<ComposeOperation, () => string>,
};
