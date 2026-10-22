import { Suspense } from "react";
import { PageSpinner } from "#modules/common/components/page-spinner.tsx";
import { HostTerminalContent } from "#modules/terminal/components/host-terminal-content.tsx";

export default function TerminalPage() {
  return (
    <main>
      <title>Terminal | Hangar</title>
      {/* Keyed, or Waku's unkeyed route slot reuses one boundary across routes. */}
      <Suspense key="terminal" fallback={<PageSpinner />}>
        <HostTerminalContent />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
