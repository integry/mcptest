import type { JsonSchema } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const matchesType = (value: unknown, type: string): boolean => {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
};

export const validateJsonSchema = (
  value: unknown,
  schema: JsonSchema,
  path = '$'
): string[] => {
  const errors: string[] = [];
  if (schema.const !== undefined && !Object.is(value, schema.const)) errors.push(`${path} must equal the declared constant.`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) errors.push(`${path} is not an allowed value.`);
  if (Array.isArray(schema.allOf)) schema.allOf.forEach(item => {
    if (isRecord(item)) errors.push(...validateJsonSchema(value, item, path));
  });
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(item => isRecord(item) && validateJsonSchema(value, item, path).length === 0)) {
    errors.push(`${path} does not match any allowed schema.`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(item => isRecord(item) && validateJsonSchema(value, item, path).length === 0).length;
    if (matches !== 1) errors.push(`${path} must match exactly one schema.`);
  }
  const allowedTypes = typeof schema.type === 'string'
    ? [schema.type]
    : Array.isArray(schema.type) ? schema.type.filter(item => typeof item === 'string') : [];
  if (allowedTypes.length && !allowedTypes.some(type => matchesType(value, type))) {
    errors.push(`${path} must be ${allowedTypes.join(' or ')}.`);
    return errors;
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    required.forEach(key => {
      if (typeof key === 'string' && !(key in value)) errors.push(`${path}.${key} is required.`);
    });
    Object.entries(value).forEach(([key, child]) => {
      if (isRecord(properties[key])) errors.push(...validateJsonSchema(child, properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed.`);
      else if (isRecord(schema.additionalProperties)) errors.push(...validateJsonSchema(child, schema.additionalProperties, `${path}.${key}`));
    });
  }
  if (Array.isArray(value) && isRecord(schema.items)) {
    value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items as JsonSchema, `${path}[${index}]`)));
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path} is too short.`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path} is too long.`);
    if (typeof schema.pattern === 'string') {
      try { if (!new RegExp(schema.pattern).test(value)) errors.push(`${path} does not match the required pattern.`); } catch { errors.push(`${path} has an invalid schema pattern.`); }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path} is below the minimum.`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path} is above the maximum.`);
  }
  return errors;
};
