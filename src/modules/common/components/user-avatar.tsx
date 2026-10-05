import { Avatar, AvatarFallback } from "#modules/common/ui/avatar.tsx";

export type AvatarUser = {
  name: string;
  email: string;
};

function getInitials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return email.slice(0, 2).toUpperCase();
  }

  const first = words[0]?.[0] ?? "";
  // A single word gives a single initial, not the same letter twice.
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";

  return `${first}${last}`.toUpperCase();
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
