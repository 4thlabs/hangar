import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import type { WidgetPlacement } from "#libs/api";
import { Region } from "#modules/common/components/region.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { widgetsQueries } from "#modules/widgets/api/widgets-queries.ts";
import { ArcaneCard } from "#modules/widgets/components/cards/arcane-card.tsx";
import { BackrestCard } from "#modules/widgets/components/cards/backrest-card.tsx";
import { BeszelCard } from "#modules/widgets/components/cards/beszel-card.tsx";
import { ClockCard } from "#modules/widgets/components/cards/clock-card.tsx";
import { DockerCard } from "#modules/widgets/components/cards/docker-card.tsx";
import { ForgejoCard } from "#modules/widgets/components/cards/forgejo-card.tsx";
import { FrigateCard } from "#modules/widgets/components/cards/frigate-card.tsx";
import { GithubCard } from "#modules/widgets/components/cards/github-card.tsx";
import { GluetunCard } from "#modules/widgets/components/cards/gluetun-card.tsx";
import { JellyfinCard } from "#modules/widgets/components/cards/jellyfin-card.tsx";
import { MinifluxCard } from "#modules/widgets/components/cards/miniflux-card.tsx";
import { StockCard } from "#modules/widgets/components/cards/stock-card.tsx";
import { TcgCollectorCard } from "#modules/widgets/components/cards/tcg-collector-card.tsx";
import { LoadedWidget } from "#modules/widgets/components/loaded-widget.tsx";
import { WidgetCardFailure, WidgetSkeleton } from "#modules/widgets/components/widget-states.tsx";
import { widgetLook } from "#modules/widgets/helpers/widget-appearance.ts";

/** `/`, the dashboard. */
export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});

/** The three columns of the dashboard, each placed in one grid, as wide screens make room for them. */
const columnNumbers = [1, 2, 3] as const;

// min-w-0: a wide row would otherwise set the column's least width, and the page would scroll sideways.
const columnClassNames: Readonly<Record<(typeof columnNumbers)[number], string>> = {
  1: "flex min-w-0 flex-col gap-4 md:col-start-1",
  2: "flex min-w-0 flex-col gap-4 md:col-start-2",
  3: "flex min-w-0 flex-col gap-4 md:col-start-2 xl:col-start-3",
};

/** The card of one placement, by its type. */
function PlacedWidget({ placement }: { placement: WidgetPlacement }) {
  const { key, link } = placement;

  switch (placement.type) {
    case "clock":
      return <ClockCard />;
    case "docker-general-stats":
      return <DockerCard />;
    case "arcane-general-stats":
      return (
        <LoadedWidget placement={placement} type="arcane-general-stats">
          {stats => <ArcaneCard stats={stats} link={link} />}
        </LoadedWidget>
      );
    case "backrest-summary":
      return (
        <LoadedWidget placement={placement} type="backrest-summary">
          {summary => <BackrestCard summary={summary} link={link} />}
        </LoadedWidget>
      );
    case "beszel-server-stats":
      return (
        <LoadedWidget placement={placement} type="beszel-server-stats">
          {stats => <BeszelCard stats={stats} link={link} />}
        </LoadedWidget>
      );
    case "forgejo-ci":
      return (
        <LoadedWidget placement={placement} type="forgejo-ci">
          {ci => <ForgejoCard ci={ci} link={link} />}
        </LoadedWidget>
      );
    case "frigate-events":
      return (
        <LoadedWidget placement={placement} type="frigate-events">
          {events => <FrigateCard events={events} placementKey={key} link={link} />}
        </LoadedWidget>
      );
    case "gluetun-vpn-status":
      return (
        <LoadedWidget placement={placement} type="gluetun-vpn-status">
          {status => <GluetunCard status={status} />}
        </LoadedWidget>
      );
    case "miniflux-entries":
      return (
        <LoadedWidget placement={placement} type="miniflux-entries">
          {entries => <MinifluxCard entries={entries} link={link} />}
        </LoadedWidget>
      );
    case "jellyfin-latest":
      return (
        <LoadedWidget placement={placement} type="jellyfin-latest">
          {latest => <JellyfinCard latest={latest} placementKey={key} link={link} />}
        </LoadedWidget>
      );
    case "tcg-collector-cards":
      return (
        <LoadedWidget placement={placement} type="tcg-collector-cards">
          {cards => <TcgCollectorCard cards={cards} placementKey={key} link={link} />}
        </LoadedWidget>
      );
    case "github-releases":
      return (
        <LoadedWidget placement={placement} type="github-releases">
          {releases => <GithubCard releases={releases} />}
        </LoadedWidget>
      );
    case "stock-prices":
      return (
        <LoadedWidget placement={placement} type="stock-prices">
          {prices => <StockCard prices={prices} />}
        </LoadedWidget>
      );
  }
}

/** A widget in its own region: a card that throws as it renders fails alone, and the rest of the dashboard stands. */
function PlacedRegion({ placement }: { placement: WidgetPlacement }) {
  const look = widgetLook(placement.type);

  return (
    <Region
      fallback={<WidgetSkeleton look={look} />}
      failure={({ retry }) => <WidgetCardFailure look={look} retry={retry} />}
    >
      <PlacedWidget placement={placement} />
    </Region>
  );
}

/**
 * The dashboard: the widgets `hangar.yml` places, in their columns, top to bottom in its order. Each card loads on its
 * own, a slow service holding its card alone; Docker's is read again as the daemon's changes come, the others as the
 * page opens and as its tab is shown again.
 */
function DashboardPage() {
  const { data: placements, error } = useQuery(widgetsQueries.placements());

  const title = <title>Dashboard | Hangar</title>;

  if (error) {
    return (
      <main>
        {title}
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>Could not read the dashboard</AlertTitle>
          <AlertDescription>{describeError(error)}</AlertDescription>
        </Alert>
      </main>
    );
  }

  if (placements === undefined) {
    return (
      <main aria-busy="true">
        {title}
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  return (
    <main className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_3fr_1fr]">
      {title}
      {columnNumbers.map(column => {
        const inColumn = placements.filter(placement => placement.column === column);

        if (inColumn.length === 0) {
          return null;
        }

        return (
          <div key={column} className={columnClassNames[column]}>
            {inColumn.map(placement => (
              <PlacedRegion key={placement.key} placement={placement} />
            ))}
          </div>
        );
      })}
    </main>
  );
}
