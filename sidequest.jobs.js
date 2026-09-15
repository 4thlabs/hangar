// Sidequest resolves a job's module by walking the stack of `new JobClass()` and `import()`ing each
// frame. In a build that frame is the bundle chunk whose top-level await is still running, so the
// import deadlocks the whole server — and the chunk renames the class anyway. `manualJobResolution`
// points the worker at this file instead: a plain module, outside the bundle, exporting every job
// class under its real name.
export { CheckImageVersion } from "./src/libs/jobs/jobs/check-image-version.ts";
