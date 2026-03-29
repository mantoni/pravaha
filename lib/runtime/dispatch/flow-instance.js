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
  getRuntimeRecordContractPath,
  getRuntimeRecordFlowPath,
} from '../records/runtime-record-model.js';

export { createFlowInstanceId, readRuntimeRecordFlowInstanceId };

/**
 * @param {Record<string, unknown>} runtime_record
 * @returns {string | null}
 */
function readRuntimeRecordFlowInstanceId(runtime_record) {
  const binding_targets = getRuntimeRecordBindingTargets(runtime_record);
  const contract_path = getRuntimeRecordContractPath(runtime_record);
  const flow_path = getRuntimeRecordFlowPath(runtime_record);

  if (
    binding_targets === null ||
    typeof contract_path !== 'string' ||
    typeof flow_path !== 'string'
  ) {
    return null;
  }

  const [binding_name, binding_target] =
    selectFlowInstanceBinding(binding_targets);

  return createFlowInstanceId(
    contract_path,
    flow_path,
    binding_name,
    binding_target.id,
  );
}

/**
 * @param {string} contract_path
 * @param {string} flow_path
 * @param {string} binding_name
 * @param {string} binding_target_id
 * @returns {string}
 */
function createFlowInstanceId(
  contract_path,
  flow_path,
  binding_name,
  binding_target_id,
) {
  const token = createHash('sha256')
    .update(
      `${contract_path}\n${flow_path}\n${binding_name}\n${binding_target_id}`,
    )
    .digest('hex')
    .slice(0, 16);

  return `flow-instance:${token}`;
}

/**
 * @param {Record<string, { id: string, path: string, status: string }>} binding_targets
 * @returns {[string, { id: string, path: string, status: string }]}
 */
function selectFlowInstanceBinding(binding_targets) {
  const flow_instance_bindings = Object.entries(binding_targets).filter(
    ([binding_name]) => binding_name !== 'document',
  );

  if (flow_instance_bindings.length !== 1) {
    throw new Error(
      `Expected exactly one non-document flow instance binding, found ${flow_instance_bindings.length}.`,
    );
  }

  return /** @type {[string, { id: string, path: string, status: string }]} */ (
    flow_instance_bindings[0]
  );
}
