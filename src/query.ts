/**
 * Query class — wraps the agent loop AsyncGenerator with control methods.
 */

import type { AgentMessage, Query } from "./types.ts";

/**
 * Create a Query that wraps an AsyncGenerator<AgentMessage> with control methods.
 */
export function createQuery(
  generator: AsyncGenerator<AgentMessage, void, undefined>,
  abortController: AbortController,
): Query {
  const query: Query = {
    // AsyncGenerator protocol
    next: generator.next.bind(generator),
    return: generator.return.bind(generator),
    throw: generator.throw.bind(generator),

    // AsyncIterable protocol
    [Symbol.asyncIterator]() {
      return this;
    },

    // Control methods
    async interrupt() {
      abortController.abort();
    },

    close() {
      abortController.abort();
      generator.return(undefined);
    },
  };

  return query;
}
