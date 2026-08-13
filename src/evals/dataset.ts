import datasetSchema from '../../public/schemas/tool-selection-eval/v1.schema.json';
import {
  TOOL_SELECTION_DATASET_VERSION,
  type EvalTool,
  type SyntheticSuggestion,
  type ToolSelectionCase,
  type ToolSelectionDatasetV1,
} from './types';
import { validateJsonSchema } from './schema';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const stringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every(item => typeof item === 'string')
);

const validateCaseSemantics = (
  value: unknown,
  path: string,
  toolNames: Set<string>,
  errors: string[]
): value is ToolSelectionCase => {
  if (!isRecord(value)) return false;
  const acceptable = stringArray(value.acceptableTools) ? value.acceptableTools : [];
  const forbidden = stringArray(value.forbiddenTools) ? value.forbiddenTools : [];
  [...acceptable, ...forbidden].forEach(name => {
    if (!toolNames.has(name)) errors.push(`${path} references unknown tool "${name}".`);
  });
  if (value.expectedNoTool === true && acceptable.length > 0) {
    errors.push(`${path} cannot expect no tool and also list acceptable tools.`);
  }
  if (value.expectedNoTool !== true && acceptable.length === 0) {
    errors.push(`${path} must set expectedNoTool or provide acceptableTools.`);
  }
  (Array.isArray(value.argumentAssertions) ? value.argumentAssertions : []).forEach((assertion, index) => {
    const assertionPath = `${path}.argumentAssertions[${index}]`;
    if (!isRecord(assertion)) return;
    if (assertion.tool !== undefined && (typeof assertion.tool !== 'string' || !toolNames.has(assertion.tool))) {
      errors.push(`${assertionPath}.tool must reference a known tool.`);
    }
    if (!['present', 'absent'].includes(String(assertion.operator)) && !('value' in assertion)) {
      errors.push(`${assertionPath}.value is required for ${String(assertion.operator)}.`);
    }
  });
  return true;
};

export const validateDataset = (value: unknown): {
  valid: boolean;
  errors: string[];
  dataset?: ToolSelectionDatasetV1;
} => {
  const errors = validateJsonSchema(value, datasetSchema);
  if (!isRecord(value)) return { valid: false, errors: ['Dataset must be a JSON object.'] };
  if (value.version !== TOOL_SELECTION_DATASET_VERSION) {
    errors.push(`Unsupported dataset version. Expected "${TOOL_SELECTION_DATASET_VERSION}".`);
  }
  const tools = Array.isArray(value.tools) ? value.tools : [];
  const toolNames = new Set<string>();
  tools.forEach(tool => {
    if (!isRecord(tool) || typeof tool.name !== 'string') return;
    if (toolNames.has(tool.name)) errors.push(`Duplicate tool name "${tool.name}".`);
    else toolNames.add(tool.name);
  });
  const ids = new Set<string>();
  (Array.isArray(value.cases) ? value.cases : []).forEach((item, index) => {
    validateCaseSemantics(item, `cases[${index}]`, toolNames, errors);
    if (isRecord(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`Duplicate case id "${item.id}".`);
      ids.add(item.id);
    }
  });
  (Array.isArray(value.suggestions) ? value.suggestions : []).forEach((item, index) => {
    validateCaseSemantics(item, `suggestions[${index}]`, toolNames, errors);
    if (isRecord(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) errors.push(`Duplicate case id "${item.id}".`);
      ids.add(item.id);
    }
  });
  return errors.length
    ? { valid: false, errors }
    : { valid: true, errors, dataset: value as unknown as ToolSelectionDatasetV1 };
};

export const parseDataset = (json: string): ToolSelectionDatasetV1 => {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const validation = validateDataset(value);
  if (!validation.valid || !validation.dataset) throw new Error(validation.errors.join('\n'));
  return validation.dataset;
};

export const getRunnableCases = (dataset: ToolSelectionDatasetV1): ToolSelectionCase[] => [
  ...dataset.cases,
  ...(dataset.suggestions || []).filter(suggestion => suggestion.reviewStatus === 'approved'),
];

const schemaExample = (tool: EvalTool): Record<string, unknown> => {
  const schema = tool.inputSchema;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = stringArray(schema.required) ? schema.required : [];
  return Object.fromEntries(required.map(name => {
    const property = isRecord(properties[name]) ? properties[name] : {};
    const example = property.example ?? property.default ?? (
      property.type === 'number' || property.type === 'integer' ? 1
        : property.type === 'boolean' ? true
          : property.type === 'array' ? []
            : 'example'
    );
    return [name, example];
  }));
};

export const suggestCases = (dataset: ToolSelectionDatasetV1): SyntheticSuggestion[] => {
  const existing = new Set([
    ...dataset.cases.map(item => item.id),
    ...(dataset.suggestions || []).map(item => item.id),
  ]);
  return dataset.tools.flatMap((tool) => {
    const baseId = `suggested-${tool.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    let id = baseId;
    let suffix = 2;
    while (existing.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    existing.add(id);
    const example = schemaExample(tool);
    return [{
      id,
      prompt: `Use the best available capability to ${tool.description || tool.name.replace(/_/g, ' ')}.`,
      acceptableTools: [tool.name],
      forbiddenTools: dataset.tools.filter(candidate => candidate.name !== tool.name).map(candidate => candidate.name),
      argumentAssertions: Object.entries(example).map(([path, value]) => ({
        path,
        operator: 'equals' as const,
        value,
      })),
      tags: ['synthetic'],
      notes: 'Generated from the tool description and schema. Review the prompt and assertions before approving.',
      synthetic: true as const,
      reviewStatus: 'unreviewed' as const,
    }];
  });
};
