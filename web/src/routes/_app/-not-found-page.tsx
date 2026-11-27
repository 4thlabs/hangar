import { Link } from "@tanstack/react-router";
import { Button } from "#modules/common/ui/button.tsx";
import { m } from "#paraglide/messages.js";

/** What a path that is no page shows, inside the app's frame. */
export function NotFoundPage() {
  return (
    <main className="items-start">
      <h1 className="text-2xl font-semibold">{m.common_not_found_title()}</h1>
      <p className="text-muted-foreground">{m.common_not_found_description()}</p>
      <Button variant="outline" render={<Link to="/">{m.common_not_found_back()}</Link>} />
    </main>
  );
}
