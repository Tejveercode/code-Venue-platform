// ---------------------------------------------------------------------------
// Exam-session monitoring — shared client types.
//
// Detection-and-logging, not prevention: the client reports single events as
// they happen; the server tallies, decides, and enforces. Clipboard CONTENT
// is never read or sent — only the event type.
// ---------------------------------------------------------------------------

/** Event types tracked per student, per room (mirrors the server schema). */
export type ViolationType = "blur" | "paste" | "copy" | "rejoin";

export const VIOLATION_EVENT_LABELS: Record<ViolationType, string> = {
  blur: "Tab switches / blur",
  paste: "Pastes into editor",
  copy: "Copies out of editor",
  rejoin: "Page loads / rejoins",
};

/** Types that count toward a room's violation limit (rejoin is audit-only). */
export function isEnforcedType(type: ViolationType): boolean {
  return type !== "rejoin";
}
