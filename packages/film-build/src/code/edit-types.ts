/**
 * The edit shapes shared by timeline write-back — accepted by both the film-doc path and the JSX path.
 *
 * Lives in its own file: doc-edit only needs these types and one rounding helper, and must not
 * drag the TypeScript compiler into the browser along with edit-props.
 */
import { FilmCliError } from '../cli-error';

/** Values write-back accepts. Objects only go to film.json (see doc-edit); the JSX path takes scalars only. */
export type PropValue = number | string | boolean | Record<string, unknown> | null;

/** Points on the timeline, in seconds. Values from a drag may carry IEEE float noise; snap to 1 ms before writing back. */
const TIME_SEC_PROPS = new Set(['at', 'start', 'end']);

function snapSec(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

export function coerceTimePropValue(
  prop: string,
  value: PropValue,
): PropValue {
  if (typeof value !== 'number' || !TIME_SEC_PROPS.has(prop)) return value;
  if (!Number.isFinite(value)) throw new FilmCliError(`${prop} is not a finite number`);
  return snapSec(value);
}

/** One edit: set this prop at this location to this value. */
export interface PropEdit {
  loc: string;
  prop: string;
  /**
   * The new value. Numbers are written as `{123}`, strings as `"…"` — the caller decides, since
   * the same prop can have different types on different components. `null` removes the prop.
   * Objects (`transform` / `mask` / `props`) can only land in film.json.
   */
  value: PropValue;
  /**
   * What the prop evaluated to before the edit.
   *
   * Only needed when the original value is **computed**: then the edit changes an offset rather
   * than the whole value (see shiftExpression), and computing the offset requires knowing where it
   * was. The source only has the expression; the answer is in the evaluation result, so the caller
   * has to pass it in.
   */
  from?: number;
}

export interface SplitEdit {
  loc: string;
  /** What the left half becomes (only the props that change). */
  left: Record<string, number>;
  /** What the right half becomes. */
  right: Record<string, number>;
}
