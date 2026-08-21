import type { IDataObject } from 'n8n-workflow';
import type { RedactionPolicy, RedactionResult, RedactionSummary, SpanSource } from './types';

export const REDACTED_VALUE = '[REDACTED]';

const AUTOMATIC_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passwd',
  'apikey',
  'aikey',
  'secretkey',
  'xapikey',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'privatekey',
]);

const AUTOMATIC_KEY_SUFFIXES = [
  'authorization',
  'cookie',
  'password',
  'passwd',
  'apikey',
  'secret',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'privatekey',
];

const CONTROLLED_TOKEN_PREFIXES = ['access', 'auth', 'bearer', 'csrf', 'id', 'refresh', 'session'];
const AI_KEY_MARKERS = [
  'openai',
  'anthropic',
  'azureopenai',
  'bedrock',
  'cohere',
  'gemini',
  'google',
  'llm',
  'mistral',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isAutomaticSensitiveKey(key: string): boolean {
  const normalizedKey = normalizeKey(key);
  if (AUTOMATIC_KEYS.has(normalizedKey)) return true;
  if (AUTOMATIC_KEY_SUFFIXES.some((suffix) => normalizedKey.endsWith(suffix))) return true;
  if (
    normalizedKey.endsWith('key') &&
    AI_KEY_MARKERS.some((marker) => normalizedKey.includes(marker))
  ) {
    return true;
  }
  return CONTROLLED_TOKEN_PREFIXES.some((prefix) => normalizedKey === `${prefix}token`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function automaticRedaction(value: unknown): RedactionResult {
  if (Array.isArray(value)) {
    let summary = 0;
    const redacted = value.map((entry) => {
      const result = automaticRedaction(entry);
      summary += result.matches;
      return result.value;
    });
    return { value: redacted, matches: summary };
  }

  if (!isObject(value)) return { value, matches: 0 };

  let matches = 0;
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isAutomaticSensitiveKey(key)) {
      redacted[key] = REDACTED_VALUE;
      matches++;
      continue;
    }
    const result = automaticRedaction(entry);
    redacted[key] = result.value;
    matches += result.matches;
  }
  return { value: redacted, matches };
}

function matchesSegment(segment: string, key: string): boolean {
  return segment === '*' || segment === key;
}

function redactSelectorMatch(value: unknown, segments: string[], index: number): RedactionResult {
  if (index === segments.length) {
    return value === REDACTED_VALUE ? { value, matches: 0 } : { value: REDACTED_VALUE, matches: 1 };
  }

  if (Array.isArray(value)) {
    let matches = 0;
    const nextIndex = segments[index] === '*' ? index + 1 : index;
    const redacted = value.map((entry) => {
      const result = redactSelectorMatch(entry, segments, nextIndex);
      matches += result.matches;
      return result.value;
    });
    return { value: redacted, matches };
  }

  if (!isObject(value)) return { value, matches: 0 };

  let matches = 0;
  const redacted: Record<string, unknown> = { ...value };
  for (const [key, entry] of Object.entries(value)) {
    if (!matchesSegment(segments[index], key)) continue;
    const result = redactSelectorMatch(entry, segments, index + 1);
    redacted[key] = result.value;
    matches += result.matches;
  }
  return { value: redacted, matches };
}

function redactSelectorSearch(value: unknown, segments: string[]): RedactionResult {
  if (Array.isArray(value)) {
    let matches = 0;
    const redacted = value.map((entry) => {
      const result = redactSelectorSearch(entry, segments);
      matches += result.matches;
      return result.value;
    });
    return { value: redacted, matches };
  }

  if (!isObject(value)) return { value, matches: 0 };

  let matches = 0;
  const redacted: Record<string, unknown> = { ...value };
  for (const [key, entry] of Object.entries(value)) {
    if (matchesSegment(segments[0], key)) {
      const matched = redactSelectorMatch(entry, segments, 1);
      const searched = redactSelectorSearch(matched.value, segments);
      redacted[key] = searched.value;
      matches += matched.matches + searched.matches;
    } else {
      const result = redactSelectorSearch(entry, segments);
      redacted[key] = result.value;
      matches += result.matches;
    }
  }
  return { value: redacted, matches };
}

function manualRedaction(value: unknown, selectors: string[]): RedactionResult {
  let redacted = value;
  let matches = 0;
  for (const selector of selectors) {
    const result = redactSelectorSearch(redacted, selector.split('.'));
    redacted = result.value;
    matches += result.matches;
  }
  return { value: redacted, matches };
}

export function validateRedactionPath(path: string): string {
  const segments = path.split('.');
  if (
    path.length === 0 ||
    segments.some((segment) => segment.length === 0 || (segment !== '*' && /[*.[\]]/.test(segment)))
  ) {
    throw new Error(`Invalid redaction path '${path}'`);
  }
  return segments.join('.');
}

export function buildRedactionPolicy(
  automaticEnabled: boolean,
  manualEnabled: boolean,
  fields: IDataObject,
): RedactionPolicy {
  if (!manualEnabled) {
    return { automaticEnabled, manualEnabled, selectors: [] };
  }

  const fieldPaths = fields.fieldPaths;
  const entries = Array.isArray(fieldPaths) ? fieldPaths : [];
  const selectors = [
    ...new Set(
      entries.map((entry) => validateRedactionPath(String((entry as IDataObject).path || ''))),
    ),
  ];
  return { automaticEnabled, manualEnabled, selectors };
}

function redactWithPolicy(value: unknown, policy: RedactionPolicy): RedactionResult {
  let redacted = value;
  let automaticMatches = 0;
  let manualMatches = 0;

  if (policy.automaticEnabled) {
    const result = automaticRedaction(redacted);
    redacted = result.value;
    automaticMatches = result.matches;
  }
  if (policy.manualEnabled) {
    const result = manualRedaction(redacted, policy.selectors);
    redacted = result.value;
    manualMatches = result.matches;
  }
  return { value: redacted, matches: automaticMatches + manualMatches };
}

export function redactCapture(
  sources: SpanSource[],
  metadata: IDataObject,
  policy: RedactionPolicy,
): { sources: SpanSource[]; metadata: IDataObject; summary: RedactionSummary } {
  let automaticMatches = 0;
  let manualMatches = 0;

  const redact = (value: unknown): unknown => {
    const result = redactWithPolicy(value, policy);
    if (policy.automaticEnabled) {
      const automatic = automaticRedaction(value);
      automaticMatches += automatic.matches;
    }
    if (policy.manualEnabled) {
      const automaticValue = policy.automaticEnabled ? automaticRedaction(value).value : value;
      manualMatches += manualRedaction(automaticValue, policy.selectors).matches;
    }
    return result.value;
  };

  const redactedSources = sources.map((source) => ({
    ...source,
    parameters: source.parameters ? (redact(source.parameters) as IDataObject) : undefined,
    items: source.items.map((item) => redact(item) as IDataObject),
  }));

  const protectedMetadata = new Set(['workflowId', 'workflowName', 'timestamp']);
  const userMetadata: IDataObject = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!protectedMetadata.has(key)) userMetadata[key] = value;
  }
  const redactedMetadata = {
    ...metadata,
    ...((redact(userMetadata) as unknown as IDataObject) || {}),
  };

  return {
    sources: redactedSources,
    metadata: redactedMetadata,
    summary: {
      automaticEnabled: policy.automaticEnabled,
      manualEnabled: policy.manualEnabled,
      valuesRedacted: automaticMatches + manualMatches,
      automaticMatches,
      manualMatches,
    },
  };
}
