/** A section of the navigation whose page is not on the Rust server yet: the issue of its area moves it here. */
export function PendingPage() {
  return (
    <main>
      <h1 className="text-2xl font-semibold">Not here yet</h1>
      <p className="text-muted-foreground">This page is still served by the current version of Hangar.</p>
    </main>
  );
}
