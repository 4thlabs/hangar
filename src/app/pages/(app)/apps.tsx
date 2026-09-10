export default function AppsPage() {
  return (
    <main className="flex flex-1 flex-col gap-6">
      <title>Apps | Hangar</title>
      <h1 className="text-2xl font-semibold">Apps</h1>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
