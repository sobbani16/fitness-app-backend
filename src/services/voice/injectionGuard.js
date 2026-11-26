// pc-HUM-95 — server-side prompt-injection rejection for the voice pipeline.
// Transcripts are untrusted input: whether they arrive from on-device STT,
// cloud transcription, OCR, or tool results, user-controlled text must never
// override tool policy. The engine rejects injection-shaped input BEFORE any
// parsing or model call — regardless of what any model would output.
//
// LEO-081..085 scenario classes covered:
//   ignore-instructions, pretend-admin, other-user-data, direct-DB,
//   disable-allergy / disable-safety, reveal-prompt.
const INJECTION_PATTERNS = [
  // ignore / override instructions
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|rule|previous|prior|system|safety|guideline|policy|restriction)/i,
  /\b(new|different)\s+(instructions?|rules?|system\s+prompt)\b/i,
  // pretend-admin / role escalation
  /\b(i\s+am|act\s+as|pretend(ing)?\s+(to\s+be|you'?re?|you\s+are)|you\s+are\s+now|assume\s+the\s+role)\b.{0,40}\b(admin|administrator|trainer|developer|system|root|superuser|owner|staff)\b/i,
  /\b(enable|grant|give)\s+(me\s+)?(admin|developer|debug|root|elevated)\s+(mode|access|rights|privileges)/i,
  // other-user data access
  /\b(show|give|tell|list|reveal|export|read).{0,40}\b(another|other|different)\s+(user|account|person|member|client)/i,
  /\baccess\b.{0,30}\b(other|another)\s+(user|account)/i,
  // direct database / backend manipulation
  /\b(run|execute|perform)\b.{0,30}\b(sql|query|database|db\s+command)/i,
  /\b(drop|delete\s+from|truncate|alter)\s+(table|database)\b/i,
  /\bselect\s+.+\s+from\s+(users?|accounts?)\b/i,
  // disable safety / allergies — highest-severity class for this product
  /\b(disable|turn\s+off|remove|skip|ignore|stop)\b.{0,30}\b(allerg|safety|health\s+(check|warning|guard)|warning|restriction|guard)/i,
  // reveal prompt / internals
  /\b(reveal|show|print|repeat|display|output|tell\s+me)\b.{0,30}\b(system\s+prompt|instructions?|initial\s+prompt|your\s+prompt|hidden\s+prompt|config)/i,
  /\bwhat\s+(are|were)\s+your\s+(instructions|system\s+prompt|rules)/i,
];
function scanTranscript(text) {
  const t = String(text || '');
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(t);
    if (m) return { rejected: true, matched: m[0].slice(0, 60) };
  }
  return { rejected: false };
}
module.exports = { scanTranscript, INJECTION_PATTERNS };
