import { SearchIcon } from "lucide-react";
import { Field, FieldLabel } from "#app/components/ui/field.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "#app/components/ui/input-group.tsx";

type NavbarSearchProps = {
  id: string;
  autoFocus?: boolean;
};

export function NavbarSearch({ id, autoFocus }: NavbarSearchProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">
        Rechercher
      </FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput id={id} type="search" placeholder="Rechercher…" autoFocus={autoFocus} />
      </InputGroup>
    </Field>
  );
}
