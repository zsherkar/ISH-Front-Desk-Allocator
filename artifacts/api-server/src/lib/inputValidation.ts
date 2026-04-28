type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FIELD_LIMITS = {
  respondentName: 120,
  preferredName: 80,
  email: 254,
  surveyTitle: 140,
  penaltyNote: 500,
} as const;

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function firstGivenName(fullName: string): string {
  return collapseWhitespace(fullName).split(" ")[0] ?? "";
}

export function isEmailLike(value: string): boolean {
  return EMAIL_PATTERN.test(collapseWhitespace(value).toLowerCase());
}

export function safeDisplayName(preferredName: string | null | undefined, fullName: string | null | undefined): string {
  const preferred = collapseWhitespace(preferredName ?? "");
  if (preferred && !isEmailLike(preferred)) {
    return preferred;
  }

  const full = collapseWhitespace(fullName ?? "");
  return full || preferred || "Unknown";
}

export function sanitizePreferredName(preferredName: string, fullName: string): string {
  return isEmailLike(preferredName) ? firstGivenName(fullName) : preferredName;
}

export function normalizeRequiredText(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldLabel} is required.` };
  }

  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return { ok: false, error: `${fieldLabel} is required.` };
  }

  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${fieldLabel} must be ${maxLength} characters or fewer.`,
    };
  }

  return { ok: true, value: normalized };
}

export function normalizeOptionalText(
  value: unknown,
  fieldLabel: string,
  maxLength: number,
): ValidationResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: `${fieldLabel} must be text.` };
  }

  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return { ok: true, value: null };
  }

  if (normalized.length > maxLength) {
    return {
      ok: false,
      error: `${fieldLabel} must be ${maxLength} characters or fewer.`,
    };
  }

  return { ok: true, value: normalized };
}

export function normalizeEmail(
  value: unknown,
  options: { required?: boolean } = {},
): ValidationResult<string | null> {
  const { required = false } = options;

  if (value === undefined || value === null) {
    return required
      ? { ok: false, error: "Email is required." }
      : { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "Email must be text." };
  }

  const normalized = collapseWhitespace(value).toLowerCase();

  if (!normalized) {
    return required
      ? { ok: false, error: "Email is required." }
      : { ok: true, value: null };
  }

  if (normalized.length > FIELD_LIMITS.email) {
    return {
      ok: false,
      error: `Email must be ${FIELD_LIMITS.email} characters or fewer.`,
    };
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    return { ok: false, error: "Use a valid email address." };
  }

  return { ok: true, value: normalized };
}

export function dedupePositiveIntegerIds(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isInteger(value) &&
          Number.isSafeInteger(value) &&
          value > 0,
      ),
    ),
  );
}
