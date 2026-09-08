import "dotenv/config";
import ky from "ky";
import type { FrigateEvent, FrigateStats } from "./type.ts";

export const frigateUrl = `https://frigate.${process.env.DOMAIN}`;

function createApiClient() {
  const baseUrl = process.env.FRIGATE_URL;
  if (!baseUrl) throw new Error("FRIGATE_URL is not configured.");

  return ky.create({
    baseUrl,
    prefix: "/api",
  });
}

/** Gets the most recent Frigate events. */
export async function getEvents(limit: number = 5) {
  return await createApiClient().get<FrigateEvent[]>("events", { searchParams: { limit } }).json();
}

/** Gets Frigate runtime statistics. */
export async function getStats() {
  return await createApiClient().get<FrigateStats>("stats").json();
}
