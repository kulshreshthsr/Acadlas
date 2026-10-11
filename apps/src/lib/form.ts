// Error state on these forms is keyed by the field's DOM id, which lets one helper
// move the cursor to whichever field needs attention first.
export type FieldErrors = Record<string, string | undefined>;

/**
 * Puts the cursor in the first field that needs attention after a failed submit.
 * Pass the field ids in the order they appear on screen. Without this, someone on
 * a phone is left looking at a button that did nothing, with the problem scrolled
 * off above them.
 */
export function focusFirstError(fieldIds: string[], errors: FieldErrors) {
  const firstBadField = fieldIds.find((id) => errors[id]);
  if (!firstBadField) return;
  document.getElementById(firstBadField)?.focus();
}
