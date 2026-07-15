/** Filesystem-style disambiguation: "Trip" → "Trip (2)" → "Trip (3)" … skipping whichever numbers
 *  are already taken, exactly like Finder/Explorer resolving a same-named file. Used to default
 *  the rename option when a My Maps re-import collides with an existing trip (#119 follow-up). */
export function dedupeName(base: string, existingNames: string[]): string {
  if (!existingNames.includes(base)) return base;
  let n = 2;
  while (existingNames.includes(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}
