import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#app/components/ui/card.tsx";

type StatCardProps = {
  title: string;
  value: string | number;
  detail?: string;
  icon: LucideIcon;
};

export function StatCard({ title, value, detail, icon: Icon }: StatCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
        {detail && <CardDescription>{detail}</CardDescription>}
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <Icon aria-hidden="true" className="text-muted-foreground" />
      </CardContent>
    </Card>
  );
}
