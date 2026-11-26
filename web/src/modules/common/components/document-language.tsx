import { useLayoutEffect } from "react";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";

/** Keeps the document's language, and its description, in the language the user picked. */
export function DocumentLanguage() {
  const { t, locale } = useTranslation(CommonMessages);
  const description = t("metaDescription");

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", description);
  }, [locale, description]);

  return null;
}
