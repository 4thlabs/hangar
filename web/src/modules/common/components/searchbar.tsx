import { useMatches, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, FieldLabel } from "#modules/common/ui/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#modules/common/ui/input-group.tsx";

type NavbarSearchProps = {
  id: string;
  autoFocus?: boolean;
};

/** Delay before a keystroke becomes the page's `?q=`. */
const DEBOUNCE_MS = 250;

/**
 * The search field of the navbar, which drives the `?q=` of a page whose route says it is `searchable` in its
 * `staticData`; disabled on any other.
 */
export function NavbarSearch(props: NavbarSearchProps) {
  const page = useMatches({
    select: matches => {
      const last = matches.at(-1);
      const search = last?.search as { q?: unknown } | undefined;

      return {
        path: last?.pathname ?? "",
        searchable: last?.staticData.searchable === true,
        query: typeof search?.q === "string" ? search.q : "",
      };
    },
  });

  // Remounting on navigation reseeds the field from the new page's query.
  return <RouteSearchField key={page.path} {...props} searchable={page.searchable} routeQuery={page.query} />;
}

type RouteSearchFieldProps = NavbarSearchProps & { searchable: boolean; routeQuery: string };

function RouteSearchField({ id, autoFocus, searchable, routeQuery }: RouteSearchFieldProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState(routeQuery);

  useEffect(() => {
    if (!searchable || value === routeQuery) {
      return;
    }

    const timer = setTimeout(
      () =>
        void navigate({
          to: ".",
          search: (previous: Record<string, unknown>) => ({ ...previous, q: value || undefined }),
          replace: true,
        } as never),
      DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
  }, [value, routeQuery, searchable, navigate]);

  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">
        Search
      </FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          placeholder={searchable ? "Search…" : "Search unavailable here"}
          autoFocus={autoFocus}
          // No search on this page: nothing to drive, so don't swallow the keystrokes.
          disabled={!searchable}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      </InputGroup>
    </Field>
  );
}
