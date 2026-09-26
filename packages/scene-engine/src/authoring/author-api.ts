/** Small helpers for the authoring layer. Components themselves are built on the fly by `packComponent` from `@animspark/scene-engine/react`. */

/** Turn a camelCase / kebab component name into its JSX tag form: `pianoRoll` -> `PianoRoll`. */
export function animsparkJsxName(componentName: string): string {
  return componentName
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
