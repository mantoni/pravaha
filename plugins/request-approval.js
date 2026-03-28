import { definePlugin } from 'pravaha';

export default definePlugin({
  /**
   * @param {{
   *   requestApproval?: unknown,
   * }} context
   */
  async run(context) {
    const plugin_context = /** @type {{
     *   requestApproval: () => Promise<void>,
     * }} */ (context);

    await plugin_context.requestApproval();
  },
});
