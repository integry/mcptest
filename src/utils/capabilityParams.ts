export interface CapabilityInputDefinition {
  name: string;
  type?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  format?: string;
  title?: string;
  required?: boolean;
  /** JSON Schema `examples`; the first one is offered in the form. */
  examples?: unknown[];
}

/** The first example value the schema provides for a field, if any. */
export const getExampleValue = (definition: CapabilityInputDefinition): unknown => {
  if (Array.isArray(definition.examples) && definition.examples.length > 0) return definition.examples[0];
  return undefined;
};

/** A short, single-line rendering of an example for hints and placeholders. */
export const formatExampleValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

export interface CapabilityInputSpec {
  definitions: CapabilityInputDefinition[];
  required: string[];
}

export const getCapabilityInputSpec = (item: any): CapabilityInputSpec => {
  const inputSchema = item?.inputSchema || item?.input_schema;
  if (inputSchema?.properties) {
    return {
      definitions: Object.entries(inputSchema.properties).map(([name, schema]) => ({
        name,
        ...(schema as object),
      })),
      required: Array.isArray(inputSchema.required) ? inputSchema.required : [],
    };
  }

  if (Array.isArray(item?.arguments)) {
    return {
      definitions: item.arguments,
      required: item.arguments
        .filter((argument: CapabilityInputDefinition) => argument.required)
        .map((argument: CapabilityInputDefinition) => argument.name),
    };
  }

  return { definitions: [], required: [] };
};

export const hasParameterValue = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  return typeof value !== 'string' || value.trim().length > 0;
};

export const getMissingRequiredParams = (
  item: any,
  params: Record<string, unknown>
): string[] => {
  const { required } = getCapabilityInputSpec(item);
  return required.filter((name) => !hasParameterValue(params[name]));
};

export const normalizeCapabilityParams = (
  item: any,
  params: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = { ...params };
  const { definitions, required } = getCapabilityInputSpec(item);

  for (const definition of definitions) {
    const value = normalized[definition.name];
    if (typeof value !== 'string' || (definition.type !== 'object' && definition.type !== 'array')) {
      continue;
    }

    if (!value.trim() && !required.includes(definition.name)) {
      delete normalized[definition.name];
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`“${definition.name}” must contain valid JSON.`);
    }

    if (definition.type === 'array' && !Array.isArray(parsed)) {
      throw new Error(`“${definition.name}” must be a JSON array.`);
    }
    if (
      definition.type === 'object'
      && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    ) {
      throw new Error(`“${definition.name}” must be a JSON object.`);
    }

    normalized[definition.name] = parsed;
  }

  return normalized;
};
