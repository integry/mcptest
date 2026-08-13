import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { JsonSchema } from './types';

const ajv = new Ajv2020({
  allErrors: true,
  strictSchema: true,
  strictTypes: false,
  strictTuples: false,
});

addFormats(ajv);

const validators = new WeakMap<JsonSchema, ValidateFunction>();

const formatError = (error: ErrorObject): string => (
  `${error.instancePath || '$'} ${error.message || 'does not satisfy the schema.'}`
);

const schemaCompilationError = (error: unknown): string => (
  `Schema is invalid or is not JSON Schema draft 2020-12: ${error instanceof Error ? error.message : String(error)}`
);

export const validateJsonSchemaDefinition = (schema: JsonSchema): string[] => {
  if (validators.has(schema)) return [];
  try {
    validators.set(schema, ajv.compile(schema));
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
