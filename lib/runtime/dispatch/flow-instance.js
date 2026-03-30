/**
 * Flow-instance identity helpers shared across runtime status and dispatch.
 *
 * Decided by: ../../../docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
 * Implements: ../../../docs/contracts/runtime/local-dispatch-runtime.md
 * Implements: ../../../docs/contracts/runtime/status-command.md
 * @patram
 */
import { randomBytes } from 'node:crypto';

import {
  getRuntimeRecordBindingTargets,
  getRuntimeRecordFlowInstanceId as getStoredRuntimeRecordFlowInstanceId,
  getRuntimeRecordFlowPath,
} from '../records/runtime-record-model.js';

export {
  createFlowInstanceId,
  createFlowMatchIdentity,
  readRuntimeRecordFlowInstanceId,
  readRuntimeRecordFlowMatchIdentity,
};

const FLOW_INSTANCE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const FLOW_INSTANCE_ID_LENGTH = 3;
const FLOW_INSTANCE_ID_SPACE =
  FLOW_INSTANCE_ID_ALPHABET.length ** FLOW_INSTANCE_ID_LENGTH;
const FLOW_INSTANCE_ID_REJECTION_LIMIT =
  Math.floor(256 / FLOW_INSTANCE_ID_ALPHABET.length) *
  FLOW_INSTANCE_ID_ALPHABET.length;

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function readRuntimeRecordFlowInstanceId(runtime_record) {
  return getStoredRuntimeRecordFlowInstanceId(runtime_record);
}

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function readRuntimeRecordFlowMatchIdentity(runtime_record) {
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const flow_path = getRuntimeRecordFlowPath(runtime_record);

  if (binding_targets === null || typeof flow_path !== 'string') {
    return null;
  }

  const binding_target = selectFlowInstanceBinding(binding_targets);

  return createFlowMatchIdentity(flow_path, binding_target.id);
}

/**
 * @param {Set<string>} used_flow_instance_ids
 * @param {(size: number) => Uint8Array} [random_bytes]
 * @returns {string}
 */
function createFlowInstanceId(
  used_flow_instance_ids,
  random_bytes = randomBytes,
) {
  if (used_flow_instance_ids.size >= FLOW_INSTANCE_ID_SPACE) {
    throw new Error(
      'Cannot allocate a flow-instance id because the retained three-letter id space is exhausted.',
    );
  }

  while (true) {
    const flow_instance_id = createRandomFlowInstanceId(random_bytes);

    if (!used_flow_instance_ids.has(flow_instance_id)) {
      return flow_instance_id;
    }
  }
}

/**
 * @param {string} flow_path
 * @param {string} owner_document_id
 * @returns {string}
 */
function createFlowMatchIdentity(flow_path, owner_document_id) {
  return `${flow_path}\n${owner_document_id}`;
}

/**
 * @param {Record<string, { id: string, path: string, status: string }>} binding_targets
 * @returns {{ id: string, path: string, status: string }}
 */
function selectFlowInstanceBinding(binding_targets) {
  const flow_instance_bindings = Object.values(binding_targets);

  if (flow_instance_bindings.length !== 1) {
    throw new Error(
      `Expected exactly one flow instance owner binding, found ${flow_instance_bindings.length}.`,
    );
  }

  return flow_instance_bindings[0];
}

/**
 * @param {(size: number) => Uint8Array} random_bytes
 * @returns {string}
 */
function createRandomFlowInstanceId(random_bytes) {
  let flow_instance_id = '';

  while (flow_instance_id.length < FLOW_INSTANCE_ID_LENGTH) {
    const random_values = random_bytes(FLOW_INSTANCE_ID_LENGTH);

    for (const random_value of random_values) {
      if (random_value >= FLOW_INSTANCE_ID_REJECTION_LIMIT) {
        continue;
      }

      flow_instance_id +=
        FLOW_INSTANCE_ID_ALPHABET[
          random_value % FLOW_INSTANCE_ID_ALPHABET.length
        ];

      if (flow_instance_id.length === FLOW_INSTANCE_ID_LENGTH) {
        return flow_instance_id;
      }
    }
  }

  return flow_instance_id;
}
