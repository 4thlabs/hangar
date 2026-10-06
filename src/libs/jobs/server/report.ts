import { Sidequest } from "sidequest";
import { cache } from "#libs/cache/server";
import { ImageCheckReport } from "../report.ts";

/** The report the web server reads, over Sidequest's own job table. */
export const imageCheckReport = new ImageCheckReport(filter => Sidequest.job.list(filter), cache);
