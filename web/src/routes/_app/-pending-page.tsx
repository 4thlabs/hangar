import { commonMessages } from "#modules/common/messages.ts";

/** A section of the navigation whose page is not on the Rust server yet: the issue of its area moves it here. */
export function PendingPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">{commonMessages.shell.pending.title}</h1>
      <p className="text-muted-foreground">{commonMessages.shell.pending.description}</p>
    </main>
  );
}
