// The MSW handlers orval writes from the contract, one per operation, for the tests: an entry point of its own, so that
// msw and faker stay out of the page's bundle (ADR 0002, decision 13).
export * from "../generated.msw.ts";
