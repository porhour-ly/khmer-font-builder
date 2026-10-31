/** Bumped whenever a custom brush's image changes, so cached drawings re-render. */
let version = 0;

export function brushVersion(): number {
  return version;
}

export function bumpBrushVersion(): void {
  version++;
}
