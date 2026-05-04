/**
 * PII redaction pass run on every chunk before embedding/storage.
 *
 * Defense-in-depth: even if a corpus file is accidentally listed as `public`
 * with personal contact details inside it, those details never reach the
 * vector store. The bot can still answer "how do I get in touch?" by directing
 * visitors to LinkedIn / blog (handled at persona/system-prompt level).
 *
 * Patterns covered: email, AU/intl phone numbers, AU street addresses
 * (best-effort heuristic). Code/URLs are not touched — the chunker already
 * scopes most of these to body text.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// AU mobile (04xx xxx xxx), landline with area code (07 xxxx xxxx),
// international (+61 4xx xxx xxx). Allow space / hyphen / dot separators.
// Require enough digits to avoid eating things like "10 000" or "v6.12".
const PHONE_RE =
  /(?:(?:\+?\d{1,3}[\s-.]?)?(?:\(?0?\d{1,4}\)?[\s-.]?)?\d{3,4}[\s-.]?\d{3,4})(?=\b|$)/g;

// AU street address heuristic:
//  optional unit prefix, number, street name, type (St/Rd/Ave/...)
const AU_STREET_RE =
  /\b(?:(?:Unit|Apt|Suite)\s+\d+[A-Z]?[\s,/-]+)?\d{1,4}[A-Z]?\s+[A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Crescent|Cres|Highway|Hwy|Parade|Pde|Terrace|Tce|Boulevard|Blvd|Way|Close|Cl)\b\.?/g;

// AU postcode pattern: state + 4-digit postcode (very specific to avoid false positives)
const AU_POSTCODE_RE = /\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/g;

const PHONE_LIKE_DIGIT_FLOOR = 9; // require ≥9 digits to count as a phone number

function isLikelyPhoneNumber(match: string): boolean {
  const digits = match.replace(/\D/g, "");
  if (digits.length < PHONE_LIKE_DIGIT_FLOOR) {
    return false;
  }
  // 4-digit years and other date-shaped numbers leak through PHONE_RE.
  // A real phone has at least two run-of-digits groups separated by space/hyphen/dot
  // OR begins with + or 0.
  if (/^\+/.test(match) || /^0/.test(match.replace(/^[\s(]+/, ""))) {
    return true;
  }
  return /\d[\s.-]\d/.test(match);
}

export type RedactStats = {
  emails: number;
  phones: number;
  addresses: number;
};

export type RedactResult = {
  text: string;
  stats: RedactStats;
};

export function redactPii(input: string): RedactResult {
  const stats: RedactStats = { emails: 0, phones: 0, addresses: 0 };

  let out = input.replace(EMAIL_RE, () => {
    stats.emails++;
    return "[REDACTED-EMAIL]";
  });

  out = out.replace(PHONE_RE, (match) => {
    if (!isLikelyPhoneNumber(match)) {
      return match;
    }
    stats.phones++;
    return "[REDACTED-PHONE]";
  });

  out = out.replace(AU_STREET_RE, () => {
    stats.addresses++;
    return "[REDACTED-ADDRESS]";
  });

  out = out.replace(AU_POSTCODE_RE, (match) => {
    stats.addresses++;
    // Keep the state, drop the postcode.
    return match.replace(/\d{4}$/, "[REDACTED]");
  });

  return { text: out, stats };
}
