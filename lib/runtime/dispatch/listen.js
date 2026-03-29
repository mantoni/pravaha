/** @import { Server } from 'node:net' */

import { isAddressInUseError } from './protocol.js';

export { tryListen };

/**
 * @param {Server} dispatcher_server
 * @param {string} endpoint_address
 * @returns {Promise<boolean>}
 */
async function tryListen(dispatcher_server, endpoint_address) {
  try {
    await new Promise((resolve_listen, reject_listen) => {
      dispatcher_server.once('error', reject_listen);
      dispatcher_server.listen(endpoint_address, () => {
        dispatcher_server.off('error', reject_listen);
        resolve_listen(undefined);
      });
    });

    return true;
  } catch (error) {
    if (isAddressInUseError(error)) {
      return false;
    }

    throw error;
  }
}
