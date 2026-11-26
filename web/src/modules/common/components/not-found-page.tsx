import { Link } from "@tanstack/react-router";
import { Button } from "#modules/common/ui/button.tsx";

/** What a path that is no page shows, inside the app's frame. */
export function NotFoundPage() {
  return (
    <main className="items-start">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">Nothing lives at this address.</p>
      <Button variant="outline" render={<Link to="/">Back to the dashboard</Link>} />
    </main>
  );
}
