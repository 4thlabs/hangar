import { Suspense } from "react";
import { ArcaneGeneralStatsSkeleton, ArcaneGeneralStatsWidget } from "#libs/widgets";

export default function HomePage() {
  return (
    <main className="flex flex-col gap-6">
      <title>Dashboard | Hangar</title>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_2fr_1fr]">
        <Suspense fallback={<ArcaneGeneralStatsSkeleton />}>
          <ArcaneGeneralStatsWidget />
        </Suspense>
      </div>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
