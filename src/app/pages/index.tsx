import { Link } from 'waku';

export default async function HomePage() {
  const data = await getData();

  return (
    <div>
      <title>{data.title}</title>
      Future Dashbord
    </div>
  );
}

const getData = async () => {
  const data = {
    title: 'Dashbaord | Hangar',
  };

  return data;
};

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
