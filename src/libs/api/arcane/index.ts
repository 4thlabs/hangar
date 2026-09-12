export * from "./type.ts";
export * from "./client.ts";
// NOT management.ts: it imports #libs/hangar (SQLite + Docker) and widgets
// import this barrel from the RSC graph. The CLI imports it directly.
