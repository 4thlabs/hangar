import "dotenv/config";
import ky from "ky";
import type { FrigateEvent, FrigateStats } from "./type.ts";

export const frigateUrl = `https://frigate.${process.env.DOMAIN}`;

export const apiClient = ky.create({
  baseUrl: process.env.FRIDATE_API_URL || frigateUrl,
  prefix: "/api",
});

/** Gets the most recent Frigate events. */
export async function getEvents(limit: number = 5) {
  return await apiClient.get<FrigateEvent[]>("events", { searchParams: { limit } }).json();
}

/** Gets Frigate runtime statistics. */
export async function getStats() {
  return await apiClient.get<FrigateStats>("stats").json();
}
