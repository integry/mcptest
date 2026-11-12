/**
 * Validates a catalog submission against the published JSON Schema plus the
 * rules a schema cannot express (credential-free public endpoints, evidence
 * that belongs to the submitted URL). Used by the Worker and the workflow script.
 * The browser form uses validateCatalogSubmissionDraft instead, so this module
 * and the schema file stay out of the app bundle.
 */
import { Validator, type OutputUnit } from '@cfworker/json-schema';
import submissionSchema from '../../public/schemas/catalog-submission/v1.schema.json';
import {
  getSubmissionEndpointError,
  getSubmissionUrlError,
  isSubmittableEvidence,
  type CatalogSubmission,
} from './catalogSubmission';

export { submissionSchema };

const validator = new Validator(submissionSchema as Record<string, unknown>, '2020-12', false);

// Keyword failures that only say "a nested $ref/properties/allOf failed" repeat a more specific error.
const WRAPPER_KEYWORDS = new Set(['properties', '$ref', 'allOf', 'if', 'then', 'else']);

const describeSchemaErrors = (errors: OutputUnit[]): string[] => {
  const specific = errors.filter((error) => !WRAPPER_KEYWORDS.has(error.keyword));
  const messages = (specific.length > 0 ? specific : errors).map((error) => {
    const location = error.instanceLocation.replace(/^#\/?/, '') || 'body';
    return `${location}: ${error.error}`;
  });
  return Array.from(new Set(messages)).slice(0, 10);
};

export type CatalogSubmissionValidation =
  | { valid: true; submission: CatalogSubmission }
  | { valid: false; errors: string[] };

export const validateCatalogSubmission = (value: unknown): CatalogSubmissionValidation => {
  // Validate the JSON form: undefined properties are absent, as they are on the wire.
  let json: unknown;
  try {
    json = JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { valid: false, errors: ['body: the submission is not JSON-serializable'] };
  }
  const result = validator.validate(json);
  if (!result.valid) return { valid: false, errors: describeSchemaErrors(result.errors) };

  const submission = json as CatalogSubmission;
  const errors = [
    getSubmissionEndpointError(submission.url),
    getSubmissionUrlError(submission.homepageUrl, 'Homepage URL'),
    submission.logoUrl === undefined ? undefined : getSubmissionUrlError(submission.logoUrl, 'Logo URL'),
    submission.evidence.validatedUrl === undefined
      ? undefined
      : getSubmissionUrlError(submission.evidence.validatedUrl, 'Evidence validatedUrl'),
    isSubmittableEvidence(submission.evidence, submission.url)
      ? undefined
      : 'evidence: the browser check must belong to the submitted URL and show an MCP server or an authentication challenge.',
  ].filter((error): error is string => Boolean(error));

  return errors.length > 0 ? { valid: false, errors } : { valid: true, submission };
};
