// src/validators/principalJudge.validator.ts
import type { PrincipalJudge } from './principalJudge.types';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface ValidationResult<T = void> {
  valid: boolean;
  errors: Record<string, string>;
  data?: T;
}

const ok = <T>(data?: T): ValidationResult<T> => ({ valid: true, errors: {}, data });
const fail = <T>(errors: Record<string, string>): ValidationResult<T> => ({
  valid: false,
  errors,
});

// ─── Primitive rules ──────────────────────────────────────────────────────────

const TENURE_RE = /^\d{4}\s*[–-]\s*(\d{4}|Present|present)$/;
const URL_RE = /^https?:\/\/.+/i;
const NAME_RE = /^[A-Za-z][A-Za-z.'’\-\s]+$/;

export const isNonEmptyString = (v: unknown, min = 1): v is string =>
  typeof v === 'string' && v.trim().length >= min;

export const isValidTenure = (v: unknown): v is string =>
  typeof v === 'string' && TENURE_RE.test(v.trim());

export const isValidImageUrl = (v: unknown): boolean =>
  v === '' || v === undefined || v === null || (typeof v === 'string' && URL_RE.test(v));

export const isValidName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length >= 3 && NAME_RE.test(v.trim());

// ─── Principal Judge validator ────────────────────────────────────────────────

export interface PrincipalJudgeInput {
  name: string;
  tenure: string;
  station?: string;
  shortBio: string;
  fullBio: string;
  keyContributions: string[];
  image?: string;
  isCurrent?: boolean;
}

/**
 * Validate a single Principal Judge record.
 * Returns a normalized copy in `data` when valid.
 */
export const validatePrincipalJudge = (
  input: Partial<PrincipalJudgeInput>
): ValidationResult<PrincipalJudgeInput> => {
  const errors: Record<string, string> = {};

  // name
  if (!isNonEmptyString(input.name)) {
    errors.name = 'Name is required.';
  } else if (!isValidName(input.name)) {
    errors.name =
      'Name must be at least 3 characters and contain only letters, spaces, periods, hyphens, or apostrophes.';
  } else if (input.name.trim().length > 200) {
    errors.name = 'Name must not exceed 200 characters.';
  }

  // tenure
  if (!isNonEmptyString(input.tenure)) {
    errors.tenure = 'Tenure is required.';
  } else if (!isValidTenure(input.tenure)) {
    errors.tenure = 'Tenure must match "YYYY – YYYY" or "YYYY – Present" (e.g. 2022 – Present).';
  }

  // station (optional)
  if (input.station !== undefined && input.station !== null) {
    if (typeof input.station !== 'string') {
      errors.station = 'Station must be a string.';
    } else if (input.station.trim().length > 300) {
      errors.station = 'Station must not exceed 300 characters.';
    }
  }

  // shortBio
  if (!isNonEmptyString(input.shortBio)) {
    errors.shortBio = 'Short bio is required.';
  } else if (input.shortBio.trim().length > 400) {
    errors.shortBio = 'Short bio must not exceed 400 characters.';
  }

  // fullBio
  if (!isNonEmptyString(input.fullBio)) {
    errors.fullBio = 'Full bio is required.';
  } else if (input.fullBio.trim().length < 50) {
    errors.fullBio = 'Full bio should be at least 50 characters.';
  } else if (input.fullBio.trim().length > 5000) {
    errors.fullBio = 'Full bio must not exceed 5000 characters.';
  }

  // keyContributions
  if (!Array.isArray(input.keyContributions)) {
    errors.keyContributions = 'Key contributions must be an array.';
  } else if (input.keyContributions.length === 0) {
    errors.keyContributions = 'At least one key contribution is required.';
  } else if (input.keyContributions.length > 20) {
    errors.keyContributions = 'At most 20 key contributions are allowed.';
  } else {
    input.keyContributions.forEach((item, i) => {
      if (!isNonEmptyString(item)) {
        errors[`keyContributions.${i}`] = `Contribution #${i + 1} cannot be empty.`;
      } else if (item.trim().length > 500) {
        errors[`keyContributions.${i}`] = `Contribution #${i + 1} must not exceed 500 characters.`;
      }
    });
  }

  // image (optional)
  if (!isValidImageUrl(input.image)) {
    errors.image = 'Image must be a valid http(s) URL or left empty.';
  }

  // isCurrent (optional)
  if (input.isCurrent !== undefined && typeof input.isCurrent !== 'boolean') {
    errors.isCurrent = 'isCurrent must be a boolean.';
  }

  if (Object.keys(errors).length > 0) return fail(errors);

  return ok({
    name: input.name!.trim(),
    tenure: input.tenure!.trim(),
    station: input.station?.trim() || undefined,
    shortBio: input.shortBio!.trim(),
    fullBio: input.fullBio!.trim(),
    keyContributions: input.keyContributions!.map((s) => s.trim()),
    image: input.image?.trim() || '',
    isCurrent: input.isCurrent ?? false,
  });
};

// ─── List-level rules ─────────────────────────────────────────────────────────

/**
 * Ensures at most one record is marked as current.
 * Useful before persisting to the backend.
 */
export const validateSingleCurrent = (
  judges: Array<Pick<PrincipalJudge, 'id' | 'isCurrent'>>
): ValidationResult => {
  const currentCount = judges.filter((j) => j.isCurrent).length;
  if (currentCount > 1) {
    return fail({
      isCurrent: `Only one Principal Judge can be marked as current (found ${currentCount}).`,
    });
  }
  return ok();
};

/**
 * Ensure no duplicate tenures across the list.
 */
export const validateUniqueTenures = (
  judges: Array<Pick<PrincipalJudge, 'id' | 'tenure'>>
): ValidationResult => {
  const seen = new Map<string, string>();
  const errors: Record<string, string> = {};

  for (const j of judges) {
    const key = j.tenure.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) {
      errors[j.id] = `Duplicate tenure "${j.tenure}" (also used by ${seen.get(key)}).`;
    } else {
      seen.set(key, j.id);
    }
  }

  return Object.keys(errors).length ? fail(errors) : ok();
};

// ─── Convenience guards for API payloads ──────────────────────────────────────

export const isPrincipalJudge = (v: unknown): v is PrincipalJudge => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.tenure === 'string' &&
    typeof o.shortBio === 'string' &&
    typeof o.fullBio === 'string' &&
    Array.isArray(o.keyContributions) &&
    o.keyContributions.every((k) => typeof k === 'string') &&
    typeof o.image === 'string'
  );
};

export const isPrincipalJudgeArray = (v: unknown): v is PrincipalJudge[] =>
  Array.isArray(v) && v.every(isPrincipalJudge);