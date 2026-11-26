import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon } from "lucide-react";
import { useState } from "react";
import { authMutations, authQueries } from "#modules/auth/api/auth-queries.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#modules/common/ui/dropdown-menu.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { UserAvatar } from "#routes/-shell/user-avatar.tsx";

/** The signed-in user, and signing out. Its user settings and its language come with the issue of `/user/settings`. */
export function UserMenu() {
  const { data: user } = useQuery(authQueries.session());
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation(authMutations.logout());
  const [failed, setFailed] = useState(false);

  if (!user) {
    return null;
  }

  async function handleSignOut() {
    setFailed(false);

    try {
      await logout.mutateAsync();
    } catch (error) {
      console.error("Sign-out request failed", error);
      setFailed(true);

      return;
    }

    queryClient.clear();
    await navigate({ to: "/login", replace: true });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className="cursor-pointer lg:h-9 lg:w-auto lg:gap-1.5 lg:px-2.5"
            variant="ghost"
            size="icon"
            aria-label={`User menu of ${user.name}`}
          />
        }
      >
        <UserAvatar user={user} />
        <span className="hidden max-w-36 truncate lg:inline">{user.name}</span>
        <ChevronDownIcon data-icon="inline-end" className="hidden lg:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left">
              <UserAvatar user={user} />
              <div className="grid flex-1 leading-tight">
                <span className="truncate font-medium text-foreground">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            disabled={logout.isPending}
            closeOnClick={false}
            onClick={() => void handleSignOut()}
          >
            {logout.isPending ? <Spinner /> : <LogOutIcon />}
            <span>{logout.isPending ? "Signing out…" : "Sign out"}</span>
          </DropdownMenuItem>
          {failed && (
            <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
              Could not sign you out. Try again.
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
