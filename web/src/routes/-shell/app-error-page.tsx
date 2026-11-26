import { useRouteContext, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { AppFrame } from "#routes/-shell/app-layout.tsx";

/**
 * What the app's frame shows when it could not open, its session unread, or when a page in it failed: why, in the
 * frame, and a retry that asks the server for the session again and opens the page again.
 */
export function AppErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { session } = useRouteContext({ from: "__root__" });

  async function handleRetry() {
    session.forgetFailure();

    try {
      await router.invalidate();
    } catch (failure) {
      console.error("Opening the page again failed", failure);
    }
  }

  return (
    <AppFrame>
      <main className="items-start">
        <h1 className="text-2xl font-semibold">Could not open this page</h1>
        <p className="text-muted-foreground">{describeError(error)}</p>
        <Button variant="outline" onClick={() => void handleRetry()}>
          Try again
        </Button>
      </main>
    </AppFrame>
  );
}
