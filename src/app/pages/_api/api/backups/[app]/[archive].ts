import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ApiContext } from "waku/router";
import { backups } from "#libs/backups/server";
import { apiRoute } from "#app/api/api-route.ts";

/**
 * Downloads one archive of an app. The URL names it without its extension, so its last segment never
 * looks like a static file; the browser saves it under `<app>-<archive>.zip`.
 */
export const GET = apiRoute<ApiContext<"/api/backups/[app]/[archive]">>(
  {
    log: "Failed to send a backup archive",
    unavailable: "Les sauvegardes sont indisponibles.",
    notFound: "Cette archive n’existe pas.",
  },
  async (_request, { params }) => {
    const download = await backups.file(params.app, params.archive);

    // Streamed: an archive can weigh gigabytes. A client that leaves cancels the stream, which closes the file.
    return new Response(Readable.toWeb(createReadStream(download.path)) as ReadableStream<Uint8Array>, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${download.downloadName}"`,
        "Content-Length": String(download.size),
        "Content-Type": "application/zip",
      },
    });
  },
);
