import { expect, it } from 'vitest';

import {
  createFlowInstanceId,
  createFlowMatchIdentity,
  readRuntimeRecordFlowInstanceId,
  readRuntimeRecordFlowMatchIdentity,
} from './flow-instance.js';

it('allocates three-letter lower-case flow-instance ids', () => {
  const flow_instance_id = createFlowInstanceId(new Set(), () =>
    Uint8Array.from([0, 1, 2]),
  );

  expect(flow_instance_id).toBe('abc');
});

it('retries allocation until it finds a free id', () => {
  let call_count = 0;
  const flow_instance_id = createFlowInstanceId(new Set(['abc']), () => {
    call_count += 1;

    return call_count === 1
      ? Uint8Array.from([0, 1, 2])
      : Uint8Array.from([3, 4, 5]);
  });

  expect(flow_instance_id).toBe('def');
});

it('reads stored flow-instance ids and exact flow-match identities', () => {
  const runtime_record = {
    binding_targets: {
      doc: {
        id: 'task:demo',
        path: 'docs/tasks/demo.md',
        status: 'ready',
      },
    },
    flow_instance_id: 'abc',
    flow_path: 'docs/flows/runtime/demo.yaml',
  };

  expect(readRuntimeRecordFlowInstanceId(runtime_record)).toBe('abc');
  expect(readRuntimeRecordFlowMatchIdentity(runtime_record)).toBe(
    createFlowMatchIdentity('docs/flows/runtime/demo.yaml', 'task:demo'),
  );
});
