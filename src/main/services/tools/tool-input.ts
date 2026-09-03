import Ajv, { ErrorObject } from 'ajv';

export type JsonObject = Record<string, unknown>;

export type PreparedToolInput =
  | { kind: 'valid'; input: JsonObject }
  | { kind: 'invalid'; error: string };

export type ParsedToolArguments =
  | { kind: 'valid'; input: JsonObject }
  | { kind: 'invalid'; error: string };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseToolArguments(value: string): ParsedToolArguments {
  if (value.trim() === '') return { kind: 'valid', input: {} };

  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed)
      ? { kind: 'valid', input: parsed }
      : { kind: 'invalid', error: 'tool arguments must be a JSON object' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', error: `tool arguments contain invalid JSON: ${message}` };
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'arguments do not match the JSON Schema';
  return errors
    .map(error => `${error.dataPath || '/'} ${error.message || 'is invalid'}`)
    .join('; ');
}

function createValidator(useDefaults: boolean): Ajv.Ajv {
  return new Ajv({
    allErrors: true,
    jsonPointers: true,
    useDefaults,
  });
}

export function parseStoredJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function prepareToolInput({
  schema,
  defaultInput,
  input,
}: {
  schema: unknown;
  defaultInput?: unknown;
  input: unknown;
}): PreparedToolInput {
  if (!isJsonObject(input)) {
    return { kind: 'invalid', error: 'tool arguments must be a JSON object' };
  }
  if (!isJsonObject(schema)) {
    return { kind: 'invalid', error: 'tool definition has an invalid JSON Schema' };
  }
  if (defaultInput !== undefined && !isJsonObject(defaultInput)) {
    return { kind: 'invalid', error: 'configured default arguments must be a JSON object' };
  }

  const effectiveInput: JsonObject = {
    ...(defaultInput || {}),
    ...input,
  };

  try {
    const validate = createValidator(true).compile(schema);
    if (!validate(effectiveInput)) {
      return { kind: 'invalid', error: formatErrors(validate.errors) };
    }
    return { kind: 'valid', input: effectiveInput };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', error: `tool definition has an invalid JSON Schema: ${message}` };
  }
}

export function validateDefaultInput({
  schema,
  defaultInput,
}: {
  schema: unknown;
  defaultInput: unknown;
}): string | null {
  if (!isJsonObject(defaultInput)) return 'Default arguments must be a JSON object.';
  if (!isJsonObject(schema)) return 'JSON Schema must be an object.';

  const { required: _required, ...partialSchema } = schema;
  try {
    const validate = createValidator(false).compile(partialSchema);
    return validate(defaultInput) ? null : `Default arguments are invalid: ${formatErrors(validate.errors)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Invalid JSON Schema: ${message}`;
  }
}
