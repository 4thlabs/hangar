export default function StorePage() {
  return (
    <main className="flex flex-1 flex-col gap-6">
      <title>Store | Hangar</title>
      <h1 className="text-2xl font-semibold">Store</h1>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
