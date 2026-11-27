import type { ContainerHealth, ContainerState, ProjectStatus } from "#libs/api";
import type { AppUpdate } from "#modules/apps/helpers/apps-search.ts";
import type { AppRunStatus } from "#modules/apps/helpers/compose-output.ts";
import type { StreamStatus } from "#modules/common/hooks/use-event-stream.ts";
import { m } from "#paraglide/messages.js";

/** The words of each value `apps` shows a label of, by the type that lists them: a new value is a type error here. */
export const appsLabels = {
  /** What each status is called, as the Waku version calls it. */
  status: {
    running: m.apps_status_running,
    partial: m.apps_status_partial,
    stopped: m.apps_status_stopped,
    unhealthy: m.apps_status_unhealthy,
  } satisfies Record<ProjectStatus, () => string>,
  /** What a healthcheck's word is. */
  health: {
    healthy: m.apps_health_healthy,
    unhealthy: m.apps_health_unhealthy,
    starting: m.apps_health_starting,
  } satisfies Record<ContainerHealth, () => string>,
  /** What each state of a container is called. */
  containerState: {
    created: m.apps_container_state_created,
    running: m.apps_container_state_running,
    paused: m.apps_container_state_paused,
    restarting: m.apps_container_state_restarting,
    exited: m.apps_container_state_exited,
    removing: m.apps_container_state_removing,
    dead: m.apps_container_state_dead,
    unknown: m.apps_container_state_unknown,
  } satisfies Record<ContainerState, () => string>,
  /** What the update filter's menu calls each side. */
  update: {
    available: m.apps_update_available,
    current: m.apps_update_current,
  } satisfies Record<AppUpdate, () => string>,
  /** What the compose output's panel says of each state of its stream. */
  streamStatus: {
    connecting: m.apps_stream_status_connecting,
    connected: m.apps_stream_status_connected,
    ended: m.apps_stream_status_ended,
    error: m.apps_stream_status_error,
  } satisfies Record<StreamStatus, () => string>,
  /** What the compose output's panel says of each state of an app's run. */
  runStatus: {
    waiting: m.apps_run_status_waiting,
    running: m.apps_run_status_running,
    succeeded: m.apps_run_status_succeeded,
    failed: m.apps_run_status_failed,
    not_run: m.apps_run_status_not_run,
  } satisfies Record<AppRunStatus, () => string>,
  /** What the badge of each state of a followed log says. */
  logStatus: {
    connecting: m.apps_status_connecting,
    connected: m.apps_status_connected,
    ended: m.apps_status_ended,
    error: m.apps_status_error,
  } satisfies Record<StreamStatus, () => string>,
};
