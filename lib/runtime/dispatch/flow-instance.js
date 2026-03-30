/**
 * Flow-instance identity helpers shared across runtime status and dispatch.
 *
 * Decided by: ../../../docs/decisions/runtime/flow-trigger-entrypoints-and-instance-binding.md
 * Implements: ../../../docs/contracts/runtime/local-dispatch-runtime.md
 * Implements: ../../../docs/contracts/runtime/status-command.md
 * @patram
 */
import { createHash } from 'node:crypto';

import {
  getRuntimeRecordBindingTargets,
  getRuntimeRecordFlowPath,
} from '../records/runtime-record-model.js';

export { createFlowInstanceId, readRuntimeRecordFlowInstanceId };

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function readRuntimeRecordFlowInstanceId(runtime_record) {
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const flow_path = getRuntimeRecordFlowPath(runtime_record);

  if (binding_targets === null || typeof flow_path !== 'string') {
    return null;
  }

  const binding_target = selectFlowInstanceBinding(binding_targets);

  return createFlowInstanceId(flow_path, binding_target.id);
}

/**
 * @param {string} flow_path
 * @param {string} owner_document_id
 * @returns {string}
 */
function createFlowInstanceId(flow_path, owner_document_id) {
  const token = createHash('sha256')
    .update(`${flow_path}\n${owner_document_id}`)
    .digest('hex')
    .slice(0, 16);

  return `flow-instance:${token}`;
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
