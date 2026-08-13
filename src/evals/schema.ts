import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { JsonSchema } from './types';

const validators = new WeakMap<JsonSchema, ValidateFunction>();

const compileSchema = (schema: JsonSchema): ValidateFunction => {
  // Root $id values are registered by Ajv. Isolating each root compilation keeps
  // equivalent schema objects deterministic instead of making validation depend
  // on which schema IDs were compiled earlier in this session.
  const ajv = new Ajv2020({
    allErrors: true,
    strictSchema: true,
    strictTypes: false,
    strictTuples: false,
  });
  addFormats(ajv);
  return ajv.compile(schema);
};

const formatError = (error: ErrorObject): string => (
  `${error.instancePath || '$'} ${error.message || 'does not satisfy the schema.'}`
);

const schemaCompilationError = (error: unknown): string => (
  `Schema is invalid or is not JSON Schema draft 2020-12: ${error instanceof Error ? error.message : String(error)}`
);

export const validateJsonSchemaDefinition = (schema: JsonSchema): string[] => {
  if (validators.has(schema)) return [];
  try {
    validators.set(schema, compileSchema(schema));
    return [];
  } catch (error) {
    return [schemaCompilationError(error)];
  }
};

export const validateJsonSchema = (value: unknown, schema: JsonSchema): string[] => {
  let validate = validators.get(schema);
  if (!validate) {
    const schemaErrors = validateJsonSchemaDefinition(schema);
    if (schemaErrors.length) return schemaErrors;
    validate = validators.get(schema)!;
  }
  return validate(value) ? [] : (validate.errors || []).map(formatError);
};
