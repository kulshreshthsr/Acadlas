// A school's short name. Better Auth requires it to be unique across every school
// on the platform, so it is worth getting right at creation rather than making
// someone fix it later.

/** Turns "St. Mary's Convent, Kanpur" into "st-marys-convent-kanpur". */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Matches what `toSlug` produces, so a hand-edited short name is held to the same shape. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length >= 3 && value.length <= 48;
}
