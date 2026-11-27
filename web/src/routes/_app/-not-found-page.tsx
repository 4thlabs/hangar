import { Link } from "@tanstack/react-router";
import { commonMessages } from "#modules/common/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";

/** What a path that is no page shows, inside the app's frame. */
export function NotFoundPage() {
  return (
    <main className="items-start">
      <h1 className="text-2xl font-semibold">{commonMessages.shell.notFound.title}</h1>
      <p className="text-muted-foreground">{commonMessages.shell.notFound.description}</p>
      <Button variant="outline" render={<Link to="/">{commonMessages.shell.notFound.back}</Link>} />
    </main>
  );
}
