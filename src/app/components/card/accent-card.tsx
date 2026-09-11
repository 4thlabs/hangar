import type { ComponentProps } from "react";
import { Card as CardPrimitive } from "#app/components/ui/card.tsx";
import { cn } from "#libs/utils";

export function Card({ className, ...props }: ComponentProps<typeof CardPrimitive>) {
  return <CardPrimitive className={cn("", className)} {...props} />;
}
