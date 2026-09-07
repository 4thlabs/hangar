export default async function HomePage() {
  const data = await getData();

  return (
    <div>
      <title>{data.title}</title>
      Future Dashboard
    </div>
  );
}

const getData = async () => {
  const data = {
    title: 'Dashboard | Hangar',
  };

  return data;
};

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
