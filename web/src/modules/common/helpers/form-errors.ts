import { ApiError, type ErrorDetail } from "#libs/api";
import { describeError, type ErrorCode, type ParamsOf } from "#modules/common/helpers/error-message.ts";

/**
 * Where a form shows each of the server's codes: the field its params name, or `undefined` for the whole form. A code
 * the table leaves out is the whole form's. A code with no params, or a param it does not have, is a type error.
 */
export type FieldsByCode<Field extends string> = {
  readonly [Code in ErrorCode]?: (params: ParamsOf<Code>) => Field | undefined;
};

/** A refusal placed in a form, as TanStack Form's `setErrorMap` takes it: under one field, or for the whole form. */
export type FormErrors<Field extends string> = {
  form?: string;
  fields: Partial<Record<Field, string>>;
};

/**
 * `error`, a failed call, placed in a form: under the field `fieldsByCode` gives for its code, else for the whole form.
 * Its words are `describeError`'s. A failure with no code, as a problem of quoll's or no answer at all, is the form's.
 */
export function formErrorsOf<Field extends string>(
  error: unknown,
  fieldsByCode: FieldsByCode<Field>,
): FormErrors<Field> {
  const message = describeError(error);
  const field = error instanceof ApiError && error.detail ? fieldOf(error.detail, fieldsByCode) : undefined;

  if (field === undefined) {
    return { form: message, fields: {} };
  }

  const fields: Partial<Record<Field, string>> = {};

  fields[field] = message;

  return { fields };
}

/** The field `fieldsByCode` gives for the code of `detail`, from its params. */
function fieldOf<Field extends string>(detail: ErrorDetail, fieldsByCode: FieldsByCode<Field>): Field | undefined {
  // Each entry takes the params of its own code: the table's type holds what `detail.code` alone cannot tell here.
  const fieldFor = fieldsByCode[detail.code] as ((params: unknown) => Field | undefined) | undefined;

  return fieldFor?.("params" in detail ? detail.params : undefined);
}

/**
 * The words of a field's errors, or the form's, as one text: the strings among `errors`, which are those of the client's
 * checks and of `formErrorsOf`. `undefined` when there are none.
 */
export function errorText(errors: readonly unknown[]): string | undefined {
  const texts = errors.filter(error => typeof error === "string");

  return texts.length > 0 ? texts.join(" ") : undefined;
}

/** What `submitAfterRefusal` needs of a TanStack form: its error map, and its submit. */
type SubmittableForm = {
  setErrorMap: (errorMap: { onSubmit: { fields: Record<string, never> } }) => void;
  handleSubmit: () => Promise<void>;
};

/**
 * Submits `form`, the server's last refusal cleared first: TanStack Form keeps it in the form's `onSubmit` errors,
 * which a form with no validator of its own never clears, and would refuse every submit after it, a retry after a 500
 * included. The client checks are the fields' `onSubmit` validators, which the submit runs again.
 */
export function submitAfterRefusal(form: SubmittableForm): Promise<void> {
  form.setErrorMap({ onSubmit: { fields: {} } });

  return form.handleSubmit();
}
