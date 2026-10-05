// Input cleaning shared by every handler.

export class ValidationError extends Error {
  /**
   * @param {string} message  shown at the top of the form
   * @param {Record<string,string>} fieldErrors  keyed by field path, e.g. "shipTo.postalCode"
   * @param {number} status
   */
  constructor(message, fieldErrors = {}, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
    this.status = status;
  }
}

// Strip control characters (keeping newlines and tabs), collapse surrounding
// whitespace and cap the length. Everything user-supplied goes through here.
export function cleanText(value, max = 200) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export function cleanLine(value, max = 200) {
  return cleanText(value, max).replace(/\s+/g, " ");
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value) {
  return cleanLine(value, 160).toLowerCase();
}

export function isValidEmail(value) {
  return EMAIL_RE.test(value);
}

// US ZIP or ZIP+4. Returned in canonical 12345 / 12345-6789 form.
export function normalizePostalCode(value) {
  const digits = cleanLine(value, 20).replace(/[^0-9]/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return null;
}

// Ten-digit US numbers (an optional leading 1 is dropped). Extensions and
// anything stranger are kept as typed rather than rejected.
export function normalizePhone(value) {
  const text = cleanLine(value, 40);
  if (!text) return "";
  const digits = text.replace(/[^0-9]/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return digits.length >= 7 ? text : null;
}

export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Today's calendar date where the team works, as YYYY-MM-DD. "Needed by"
// dates are compared against this rather than UTC, which is already tomorrow
// for Florida every evening.
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
