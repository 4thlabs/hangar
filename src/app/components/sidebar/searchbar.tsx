import { SearchIcon } from "lucide-react";

import { Field, FieldLabel } from "#app/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "#app/components/ui/input-group";


export function SearchBar() {
  return (
    <Field className="size-1/5">
      <InputGroup>
        <InputGroupInput id="input-group-url" placeholder="Search..." />
        <InputGroupAddon>
          <InputGroupText></InputGroupText>
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
