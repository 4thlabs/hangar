import { Avatar, AvatarFallback } from "#app/components/ui/avatar.tsx";

export type AvatarUser = {
  name: string;
  email: string;
};

function getInitials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length > 0) {
    return `${words[0]?.[0] ?? ""}${words.length > 1 ? (words.at(-1)?.[0] ?? "") : ""}`.toUpperCase();
  }

  return email.slice(0, 2).toUpperCase();
}

export function UserAvatar({ user }: { user: AvatarUser }) {
  return (
    <Avatar>
      <AvatarFallback className="bg-primary font-semibold text-primary-foreground">
        {getInitials(user.name, user.email)}
      </AvatarFallback>
    </Avatar>
  );
}
