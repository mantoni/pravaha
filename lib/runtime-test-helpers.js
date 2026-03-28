/** @import * as $12$openai$l$codex$j$sdk from '@openai/codex-sdk'; */
export { createSuccessRunResult };

/**
 * @returns {{
 *   finalResponse: string,
 *   items: Array<{ id: string, text: string, type: 'agent_message' }>,
 *   usage: { cached_input_tokens: number, input_tokens: number, output_tokens: number },
 * }}
 */
function createSuccessRunResult() {
  return {
    finalResponse: JSON.stringify({
      summary: 'Observed the ready task and reported completion.',
    }),
    items: [
      {
        id: 'message-1',
        text: 'Observed the ready task and reported completion.',
        type: 'agent_message',
      },
    ],
    usage: {
      cached_input_tokens: 0,
      input_tokens: 120,
      output_tokens: 40,
    },
  };
}
