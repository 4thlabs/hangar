import { getComposeBatchesQueryOptions } from "#libs/api";

/** The reads of the compose commands. */
export const composeQueries = {
  /**
   * The batches the server runs or ran last, whichever page started them: read again as one starts or ends, which the
   * Docker changes say.
   */
  batches: () => getComposeBatchesQueryOptions(),
};
