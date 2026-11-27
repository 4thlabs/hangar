import { m } from "#paraglide/messages.js";

/** A section of the navigation whose page is not on the Rust server yet: the issue of its area moves it here. */
export function PendingPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">{m.common_pending_title()}</h1>
      <p className="text-muted-foreground">{m.common_pending_description()}</p>
    </main>
  );
}
