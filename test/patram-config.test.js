import { expect, it } from 'vitest';

import patram_config from '../.patram.json' with { type: 'json' };

it('defines the Patram repo contract for docs and source files', () => {
  expect(patram_config).toEqual(createExpectedPatramConfig());
});

function createExpectedPatramConfig() {
  return {
    include: [
      'README.md',
      'docs/**/*.md',
      'bin/**/*.js',
      'lib/**/*.js',
      'scripts/**/*.js',
      'test/**/*.js',
    ],
    classes: createExpectedClasses(),
    fields: createExpectedFields(),
    mappings: createExpectedMappings(),
    path_classes: createExpectedPathClasses(),
    queries: createExpectedQueries(),
    relations: createExpectedRelations(),
  };
}

function createExpectedMappings() {
  return {
    ...createExpectedMarkdownNodeMappings(),
    ...createExpectedMarkdownRelationMappings(),
    ...createExpectedJsdocRelationMappings(),
  };
}

function createExpectedClasses() {
  return {
    document: {
      builtin: true,
    },
    ...Object.fromEntries(
      createExpectedClassDefinitionEntries().map(createExpectedClassEntry),
    ),
  };
}

function createExpectedFields() {
  return {
    status: {
      type: 'enum',
      values: [
        'proposed',
        'active',
        'ready',
        'blocked',
        'review',
        'done',
        'dropped',
        'accepted',
        'superseded',
      ],
      display: {
        order: 1,
      },
    },
    tracked_in: {
      type: 'path',
      path_class: 'workflow_docs',
    },
    decided_by: {
      type: 'path',
      multiple: true,
      path_class: 'decisions',
    },
    depends_on: {
      type: 'path',
      multiple: true,
      path_class: 'workflow_docs',
    },
    implements: {
      type: 'path',
      multiple: true,
      path_class: 'workflow_docs',
    },
    root_flow: {
      type: 'path',
      path_class: 'flows',
    },
  };
}

function createExpectedPathClasses() {
  return {
    contracts: {
      prefixes: ['docs/contracts/'],
    },
    decisions: {
      prefixes: ['docs/decisions/'],
    },
    tasks: {
      prefixes: ['docs/tasks/'],
    },
    flows: {
      prefixes: ['docs/flows/'],
    },
    conventions: {
      prefixes: ['docs/conventions/'],
    },
    plans: {
      prefixes: ['docs/plans/'],
    },
    reference: {
      prefixes: ['docs/reference/'],
    },
    workflow_docs: {
      prefixes: [
        'docs/contracts/',
        'docs/tasks/',
        'docs/flows/',
        'docs/decisions/',
        'docs/conventions/',
        'docs/plans/',
        'docs/reference/',
      ],
    },
  };
}

function createExpectedRelations() {
  const workflow_classes = [
    'document',
    'contract',
    'decision',
    'task',
    'flow',
    'convention',
    'plan',
    'reference',
  ];

  return {
    tracked_in: {
      from: workflow_classes,
      to: workflow_classes,
    },
    decided_by: {
      from: workflow_classes,
      to: workflow_classes,
    },
    depends_on: {
      from: workflow_classes,
      to: workflow_classes,
    },
    implements: {
      from: workflow_classes,
      to: workflow_classes,
    },
    root_flow: {
      from: ['contract'],
      to: ['flow'],
    },
  };
}

function createExpectedQueries() {
  return {
    'change-queue': {
      where:
        '($class=contract or $class=task or $class=decision) and status in [proposed, active, ready, blocked, review]',
    },
    'active-contracts': {
      where:
        '$class=contract and status in [proposed, active, blocked, review]',
    },
    'contracts-missing-decisions': {
      where:
        '$class=contract and status in [proposed, active, blocked, review] and none(out:decided_by, $class=decision and status=accepted)',
    },
    'ready-tasks': {
      where:
        '$class=task and status=ready and none(out:depends_on, status not in [done, dropped])',
    },
    'blocked-work': {
      where: '($class=contract or $class=task) and status=blocked',
    },
    'review-queue': {
      where: '($class=contract or $class=task) and status=review',
    },
    'decision-backlog': {
      where: '$class=decision and status in [proposed, active]',
    },
    'orphan-tasks': {
      where: '$class=task and none(out:tracked_in, $class=contract)',
    },
  };
}

function createExpectedMarkdownNodeMappings() {
  return {
    'markdown.directive.kind': {
      node: {
        class: 'document',
        field: '$class',
      },
    },
    'markdown.directive.id': {
      node: {
        class: 'document',
        field: '$id',
        key: 'value',
      },
    },
    'markdown.directive.status': {
      node: {
        class: 'document',
        field: 'status',
      },
    },
  };
}

function createExpectedMarkdownRelationMappings() {
  return createExpectedRelationMappings('markdown.directive');
}

function createExpectedJsdocRelationMappings() {
  return createExpectedRelationMappings('jsdoc.directive');
}

/**
 * @param {string} mapping_prefix
 */
function createExpectedRelationMappings(mapping_prefix) {
  return {
    [`${mapping_prefix}.tracked_in`]: createRelationMapping('tracked_in'),
    [`${mapping_prefix}.decided_by`]: createRelationMapping('decided_by'),
    [`${mapping_prefix}.depends_on`]: createRelationMapping('depends_on'),
    [`${mapping_prefix}.implements`]: createRelationMapping('implements'),
    [`${mapping_prefix}.root_flow`]: createRelationMapping('root_flow', 'flow'),
  };
}

/**
 * @param {string} relation_name
 * @param {string} [target_class]
 */
function createRelationMapping(relation_name, target_class = 'document') {
  return {
    emit: {
      relation: relation_name,
      target: 'path',
      target_class,
    },
  };
}

/**
 * @param {{ name: string, label: string, document_path_class: string, fields: Array<[string, 'required' | 'optional' | 'forbidden']> }} class_definition
 * @returns {[string, { label: string, schema: { document_path_class: string, fields: Record<string, { presence: 'required' | 'optional' | 'forbidden' }>, unknown_fields: 'ignore' } }]}
 */
function createExpectedClassEntry(class_definition) {
  return [
    class_definition.name,
    createExpectedClassDefinition(
      class_definition.label,
      class_definition.document_path_class,
      createFieldPresenceEntries(class_definition.fields),
    ),
  ];
}

/**
 * @returns {Array<{ name: string, label: string, document_path_class: string, fields: Array<[string, 'required' | 'optional' | 'forbidden']> }>}
 */
function createExpectedClassDefinitionEntries() {
  return [
    createExpectedClassEntryDefinition('contract', 'Contract', 'contracts', [
      ['status', 'required'],
      ['decided_by', 'optional'],
      ['depends_on', 'optional'],
      ['root_flow', 'optional'],
    ]),
    createExpectedClassEntryDefinition('decision', 'Decision', 'decisions', [
      ['status', 'required'],
      ['tracked_in', 'optional'],
    ]),
    createExpectedClassEntryDefinition('task', 'Task', 'tasks', [
      ['status', 'required'],
      ['tracked_in', 'required'],
      ['decided_by', 'optional'],
      ['depends_on', 'optional'],
      ['implements', 'optional'],
    ]),
    createExpectedClassEntryDefinition('flow', 'Flow', 'flows', [
      ['status', 'required'],
    ]),
    createExpectedClassEntryDefinition(
      'convention',
      'Convention',
      'conventions',
      [['status', 'required']],
    ),
    createExpectedClassEntryDefinition('plan', 'Plan', 'plans', [
      ['status', 'required'],
    ]),
    createExpectedClassEntryDefinition('reference', 'Reference', 'reference', [
      ['status', 'optional'],
    ]),
  ];
}

/**
 * @param {string} name
 * @param {string} label
 * @param {string} document_path_class
 * @param {Array<[string, 'required' | 'optional' | 'forbidden']>} fields
 */
function createExpectedClassEntryDefinition(
  name,
  label,
  document_path_class,
  fields,
) {
  return {
    name,
    label,
    document_path_class,
    fields,
  };
}

/**
 * @param {string} label
 * @param {string} document_path_class
 * @param {Record<string, { presence: 'required' | 'optional' | 'forbidden' }>} fields
 */
function createExpectedClassDefinition(label, document_path_class, fields) {
  return {
    label,
    schema: createClassSchema(document_path_class, fields),
  };
}

/**
 * @param {string} document_path_class
 * @param {Record<string, { presence: 'required' | 'optional' | 'forbidden' }>} fields
 * @returns {{ document_path_class: string, fields: Record<string, { presence: 'required' | 'optional' | 'forbidden' }>, unknown_fields: 'ignore' }}
 */
function createClassSchema(document_path_class, fields) {
  return {
    document_path_class,
    fields,
    unknown_fields: 'ignore',
  };
}

/**
 * @param {Array<[string, 'required' | 'optional' | 'forbidden']>} field_entries
 * @returns {Record<string, { presence: 'required' | 'optional' | 'forbidden' }>}
 */
function createFieldPresenceEntries(field_entries) {
  return Object.fromEntries(
    field_entries.map(
      /**
       * @param {[string, 'required' | 'optional' | 'forbidden']} field_entry
       * @returns {[string, { presence: 'required' | 'optional' | 'forbidden' }]}
       */
      ([field_name, presence]) => [field_name, { presence }],
    ),
  );
}
