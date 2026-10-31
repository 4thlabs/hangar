import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { cn } from "cn";
import type { ComposeService } from "#libs/docker";
import { Translation } from "#libs/i18n";
import type { LocaleCode } from "#libs/preferences";
import { MetricFormat } from "#modules/apps/format.ts";
import type { ContainerStats } from "#modules/apps/hooks/use-docker-stats.ts";
import type { ProjectServices } from "#modules/apps/project-services.ts";
import { StatusDot, type ServiceTone } from "#modules/apps/status.ts";
import { StoreMessages } from "#modules/store/messages.ts";

/**
 * The status drawn at the end of a service's key line, and what clicking it does, for a service that has containers
 * to unfold.
 */
export type ServiceMarker = { tone: ServiceTone; label: string; action?: string };

/**
 * The markers by service name, and the one of a service with no container, or `null` while Docker tells nothing:
 * no marker at all then, rather than a "not created" on every service of an app that may well be running.
 */
export type ServiceMarkers = { byService: ReadonlyMap<string, ServiceMarker>; missing: ServiceMarker } | null;

/** A service declared under `services:`, and where its key starts. */
export type ComposeServiceKey = { name: string; from: number };

type SyntaxTree = ReturnType<typeof syntaxTree>;

type MarkerState = { markers: ServiceMarkers; decorations: DecorationSet };

/**
 * A marker at the end of the line. A service with containers gets a small button, which unfolds it in the services
 * list; one with none has no row there to unfold, so its marker is plain text.
 */
class ServiceMarkerWidget extends WidgetType {
  constructor(
    readonly service: string,
    readonly marker: ServiceMarker,
    private readonly onSelect: (service: string) => void,
  ) {
    super();
  }

  // Compared by what they draw: a stats frame every second then redraws only the markers whose text changed.
  override eq(other: ServiceMarkerWidget) {
    return (
      other.service === this.service &&
      other.marker.tone === this.marker.tone &&
      other.marker.label === this.marker.label &&
      other.marker.action === this.marker.action
    );
  }

  override toDOM() {
    const isMissing = this.marker.tone === "missing";
    const marker = document.createElement(isMissing ? "span" : "button");

    marker.className = cn(
      "ml-3 inline-flex items-center gap-1.5 rounded-sm px-1.5 font-sans text-xs text-muted-foreground",
      !isMissing && "hover:bg-muted hover:text-foreground",
    );

    if (marker instanceof HTMLButtonElement) {
      marker.type = "button";
      marker.title = this.marker.action ?? this.service;
      marker.addEventListener("click", () => this.onSelect(this.service));
    }

    const dot = document.createElement("span");

    dot.className = cn("size-2 shrink-0 rounded-full", StatusDot.Class[this.marker.tone]);
    dot.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");

    label.textContent = this.marker.label;
    marker.append(dot, label);

    return marker;
  }
}

/**
 * The state of each service, drawn at the end of its key line in a compose file. The editor gets the extension
 * once, then each new reading of Docker through {@link ComposeServiceMarkers.update}.
 */
export class ComposeServiceMarkers {
  /** Replaces the markers with a new reading of Docker. */
  static readonly update = StateEffect.define<ServiceMarkers>();

  /** How long a jump may spend parsing the rest of the file, in milliseconds: a compose file takes far less. */
  private static readonly RevealParseBudget = 100;

  /** The markers, redrawn on each edit, each new reading, and each step of the background parse. */
  static extension(onSelect: (service: string) => void): Extension {
    return StateField.define<MarkerState>({
      create: () => ({ markers: null, decorations: Decoration.none }),
      update: (value, transaction) => {
        const update = transaction.effects.findLast(effect => effect.is(ComposeServiceMarkers.update));
        const markers = update ? (update.value as ServiceMarkers) : value.markers;
        const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);

        if (!transaction.docChanged && !treeChanged && markers === value.markers) {
          return value;
        }

        return { markers, decorations: ComposeServiceMarkers.decorations(transaction.state, markers, onSelect) };
      },
      provide: field => EditorView.decorations.from(field, value => value.decorations),
    });
  }

  /**
   * The markers for what Docker read: each service's containers running, its CPU and its memory, in the reader's
   * language. None before the first reading.
   */
  static create(services: ProjectServices | null, stats: ContainerStats, locale: LocaleCode): ServiceMarkers {
    if (services === null || services.state === "unavailable") {
      return null;
    }

    const missing: ServiceMarker = {
      tone: "missing",
      label: Translation.create(StoreMessages, locale)("editor.notCreated"),
    };

    if (services.state === "absent") {
      return { byService: new Map(), missing };
    }

    const byService = new Map(
      services.detail.services.map(service => [service.name, ComposeServiceMarkers.marker(service, stats, locale)]),
    );

    return { byService, missing };
  }

  /** The services declared at the top level of a compose file, in the order they are written. */
  static serviceKeys(state: EditorState, tree: SyntaxTree = syntaxTree(state)): ComposeServiceKey[] {
    const root = tree.topNode.getChild("Document")?.getChild("BlockMapping");

    const servicesPair = root
      ?.getChildren("Pair")
      .find(pair => ComposeServiceMarkers.keyName(state, pair.getChild("Key")) === "services");

    const services = servicesPair?.getChild("BlockMapping");

    if (!services) {
      return [];
    }

    return services.getChildren("Pair").flatMap(pair => {
      const key = pair.getChild("Key");
      const name = ComposeServiceMarkers.keyName(state, key);

      return key && name ? [{ name, from: key.from }] : [];
    });
  }

  /**
   * Puts the cursor on a service's key and scrolls to it. Whether the file declares it. Focus stays where it is: a
   * keyboard user unfolding a service from its row must not find Enter typing into the compose file.
   */
  static reveal(view: EditorView, service: string) {
    const { state } = view;
    // Parsed to the end first: a file that was just opened may not be, and the service may sit further down.
    const tree = ensureSyntaxTree(state, state.doc.length, ComposeServiceMarkers.RevealParseBudget) ?? undefined;
    const key = ComposeServiceMarkers.serviceKeys(state, tree).find(candidate => candidate.name === service);

    if (!key) {
      return false;
    }

    view.dispatch({ selection: { anchor: key.from }, effects: EditorView.scrollIntoView(key.from, { y: "center" }) });

    return true;
  }

  private static decorations(
    state: EditorState,
    markers: ServiceMarkers,
    onSelect: (service: string) => void,
  ): DecorationSet {
    if (!markers) {
      return Decoration.none;
    }

    const builder = new RangeSetBuilder<Decoration>();

    for (const key of ComposeServiceMarkers.serviceKeys(state)) {
      const marker = markers.byService.get(key.name) ?? markers.missing;
      const lineEnd = state.doc.lineAt(key.from).to;
      const widget = new ServiceMarkerWidget(key.name, marker, onSelect);

      builder.add(lineEnd, lineEnd, Decoration.widget({ widget, side: 1 }));
    }

    return builder.finish();
  }

  private static marker(service: ComposeService, stats: ContainerStats, locale: LocaleCode): ServiceMarker {
    const count = `${service.runningCount}/${service.containers.length}`;
    const metrics = service.containers.flatMap(container => stats[container.id] ?? []);
    const action = Translation.create(StoreMessages, locale)("editor.viewService", { service: service.name });

    // Before the first stats frame, and for a stopped service, the count alone.
    if (metrics.length === 0) {
      return { tone: service.status, label: count, action };
    }

    const cpu = ComposeServiceMarkers.sum(metrics.map(metric => metric.cpuPercent));
    const memory = ComposeServiceMarkers.sum(metrics.map(metric => metric.memoryUsage));

    const metricsLabel = `${MetricFormat.percent(cpu, locale)} · ${MetricFormat.bytes(memory, locale)}`;

    return { tone: service.status, label: `${count} · ${metricsLabel}`, action };
  }

  /**
   * The total of the values known, `null` when none is: the first frame of a stream reads the CPU as unknown, and
   * it must show as "—", not as "0.0%".
   */
  private static sum(values: (number | null)[]) {
    const known = values.filter(value => value !== null);

    return known.length > 0 ? known.reduce((total, value) => total + value, 0) : null;
  }

  /** A key's name, without the quotes a quoted key is written with. */
  private static keyName(state: EditorState, key: { from: number; to: number } | null) {
    if (!key) {
      return null;
    }

    return state.sliceDoc(key.from, key.to).replace(/^(["'])(.*)\1$/, "$2");
  }
}
