"use client";

import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { useRouter } from "waku";
import { useSearch_UNSTABLE, useSetSearch_UNSTABLE } from "waku/router/client";
import { Field, FieldLabel } from "#app/components/ui/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#app/components/ui/input-group.tsx";

type NavbarSearchProps = {
  id: string;
  autoFocus?: boolean;
};

/** Delay before a keystroke becomes an RSC roundtrip. */
const DEBOUNCE_MS = 250;

export function NavbarSearch(props: NavbarSearchProps) {
  const { path } = useRouter();

  // Remounting on navigation reseeds the field from the new route's query.
  return <RouteSearchField key={path} {...props} from={path} />;
}

function RouteSearchField({ id, autoFocus, from }: NavbarSearchProps & { from: string }) {
  // `from` is a runtime path, not a route literal: the typed `search` only exists on the page itself.
  const search = useSearch_UNSTABLE({ from: from as never }) as { q?: string } | null;
  const setSearch = useSetSearch_UNSTABLE({ from: from as never });
  const routeQuery = search?.q ?? "";
  const [value, setValue] = useState(routeQuery);

  useEffect(() => {
    if (value === routeQuery) return;
    const timer = setTimeout(() => void setSearch({ q: value } as never, { history: "replace" }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, routeQuery, setSearch]);

  // No codec on this route: nothing to drive, so don't swallow the keystrokes.
  const unsupported = search === null;

  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">
        Rechercher
      </FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          placeholder={unsupported ? "Recherche indisponible ici" : "Rechercher…"}
          autoFocus={autoFocus}
          disabled={unsupported}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      </InputGroup>
    </Field>
  );
}
