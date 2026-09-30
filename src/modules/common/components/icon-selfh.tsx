type IconSelfhProps = {
  name: string;
};

export function IconSelfh({ name }: IconSelfhProps) {
  return <img src={`https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/${name}.webp`} alt={name} className="size-6" />;
}
