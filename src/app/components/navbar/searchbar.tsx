"use client";

import { SearchIcon } from "lucide-react";
import { Field, FieldLabel } from "#app/components/ui/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#app/components/ui/input-group.tsx";
import { useRouter } from "waku";
import { useSetSearch_UNSTABLE } from "waku/router/client";

type NavbarSearchProps = {
  id: string;
  autoFocus?: boolean;
};

export function NavbarSearch({ id, autoFocus }: NavbarSearchProps) {
  const router = useRouter();
  //const search = useSetSearch_UNSTABLE();
  
  const handleChange = () => {
    router.query = "llll";
  }

  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">
        Rechercher
      </FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput id={id} type="search" placeholder="Rechercher…" autoFocus={autoFocus} onChange={handleChange}/>
      </InputGroup>
    </Field>
  );
}
