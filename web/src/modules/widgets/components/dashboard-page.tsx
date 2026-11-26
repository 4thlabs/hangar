import { CircleAlertIcon } from "lucide-react";
import { useWidgetsPlacements, type WidgetPlacement } from "#libs/api";
import { describeError } from "#modules/common/error-message.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { WidgetAppearance } from "#modules/widgets/widget-appearance.ts";
import { ArcaneCard } from "./cards/arcane-card.tsx";
import { BackrestCard } from "./cards/backrest-card.tsx";
import { BeszelCard } from "./cards/beszel-card.tsx";
import { ClockCard } from "./cards/clock-card.tsx";
import { DockerCard } from "./cards/docker-card.tsx";
import { ForgejoCard } from "./cards/forgejo-card.tsx";
import { FrigateCard } from "./cards/frigate-card.tsx";
import { GithubCard } from "./cards/github-card.tsx";
import { GluetunCard } from "./cards/gluetun-card.tsx";
import { JellyfinCard } from "./cards/jellyfin-card.tsx";
import { MinifluxCard } from "./cards/miniflux-card.tsx";
import { StockCard } from "./cards/stock-card.tsx";
import { TcgCollectorCard } from "./cards/tcg-collector-card.tsx";
import { LoadedWidget } from "./loaded-widget.tsx";
import { WidgetBoundary } from "./widget-boundary.tsx";

/** The three columns of the dashboard, each placed in one grid, as wide screens make room for them. */
class DashboardColumns {
  static readonly Numbers = [1, 2, 3] as const;

  // min-w-0: a wide row would otherwise set the column's least width, and the page would scroll sideways.
  static readonly ClassNames: Readonly<Record<(typeof DashboardColumns.Numbers)[number], string>> = {
    1: "flex min-w-0 flex-col gap-4 md:col-start-1",
    2: "flex min-w-0 flex-col gap-4 md:col-start-2",
    3: "flex min-w-0 flex-col gap-4 md:col-start-2 xl:col-start-3",
  };
}

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

/**
 * The dashboard: the widgets `hangar.yml` places, in their columns, top to bottom in its order. Each card loads on its
 * own, a slow service holding its card alone; Docker's is read again as the daemon's changes come, the others as the
 * page opens and as its tab is shown again.
 */
export function DashboardPage() {
  const { data: placements, error } = useWidgetsPlacements();

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
      {DashboardColumns.Numbers.map(column => {
        const inColumn = placements.filter(placement => placement.column === column);

        if (inColumn.length === 0) {
          return null;
        }

        return (
          <div key={column} className={DashboardColumns.ClassNames[column]}>
            {inColumn.map(placement => (
              <WidgetBoundary key={placement.key} look={WidgetAppearance.get(placement.type)}>
                <PlacedWidget placement={placement} />
              </WidgetBoundary>
            ))}
          </div>
        );
      })}
    </main>
  );
}
