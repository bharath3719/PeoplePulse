/**
 * The shift every new company starts with (TR-02), like its leave types: a
 * common Indian office day, written as data HR edits on day one. It is the
 * company's default, so it applies to everyone until a roster says otherwise.
 *
 * Grace is how late an arrival may be and still count as on time. Fifteen
 * minutes is a common SMB choice, not a rule of any Act.
 */
export const DEFAULT_SHIFT = {
  code: 'GEN',
  name: 'General',
  startMinute: 9 * 60 + 30,
  endMinute: 18 * 60 + 30,
  graceMinutes: 15,
} as const;
