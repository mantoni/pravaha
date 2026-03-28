import { expect, it } from 'vitest';

import request_approval_plugin from './request-approval.js';

it('requests approval through the plugin context helper', async () => {
  let request_count = 0;

  await request_approval_plugin.run({
    async requestApproval() {
      request_count += 1;
    },
  });

  expect(request_count).toBe(1);
});
