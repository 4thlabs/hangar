import { useMatches, useNavigate } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, FieldLabel } from "#modules/common/ui/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#modules/common/ui/input-group.tsx";

/** How long the field waits for the typing to pause before it writes `?q=`, in milliseconds. */
const typingPause = 250;

/**
 * The search field of the navbar, which drives the `?q=` of a page whose route says it is `searchable` in its
 * `staticData`, and is disabled on any other. One field at every width: two would each rewrite `?q=` to their own.
 *
 * A `?q=` that changes from elsewhere, back or a link, is followed; the one the field sent is not taken back while
 * what is typed runs ahead of it.
 */
export function NavbarSearch({ id }: { id: string }) {
  const page = useMatches({
    select: matches => {
      const last = matches.at(-1);
      const search = last?.search as { q?: unknown } | undefined;

      return {
        searchable: last?.staticData.searchable === true,
        query: typeof search?.q === "string" ? search.q : "",
      };
    },
  });

  const navigate = useNavigate();
  const [value, setValue] = useState(page.query);
  // The `?q=` last seen, and the one this field sent until it shows: a new `?q=` that is not it came from elsewhere.
  const [seen, setSeen] = useState(page.query);
  const [sent, setSent] = useState<string | null>(null);

  if (page.query !== seen) {
    setSeen(page.query);

    if (page.query === sent) {
      // The field's own, seen once: a link or a step back to the same `?q=` later is followed.
      setSent(null);
    } else {
      setValue(page.query);
    }
  }

  useEffect(() => {
    if (!page.searchable || value === page.query) {
      return;
    }

    const timer = setTimeout(() => {
      setSent(value);
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({ ...previous, q: value || undefined }),
        replace: true,
      } as never);
    }, typingPause);

    return () => clearTimeout(timer);
  }, [value, page.query, page.searchable, navigate]);

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
          placeholder={page.searchable ? "Search…" : "Search unavailable here"}
          // No search on this page: nothing to drive, so don't swallow the keystrokes.
          disabled={!page.searchable}
          value={value}
          onChange={event => setValue(event.target.value)}
        />
      </InputGroup>
    </Field>
  );
}
