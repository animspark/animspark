/**
 * What the film architecture actually gets when it imports '@animspark/stem'.
 *
 * It differs from `.` (index) **on purpose**:
 *   · Formula / CodeMorph / ExecutionTrace render synchronously and are packed directly;
 *   · Mpl uses a different drawing path (mpl-film.ts): same Pyodide backend, but the scene's
 *     render token is dead on film's DOM `<svg>` path, so it must use pack's paint to draw
 *     directly (reasons in that file's header);
 *   · the mpl warm-up side effect at the top of index is not pulled in (a film with no mpl
 *     plots should not download a dozen-plus MB of wasm); film ensures it itself the first
 *     time Mpl actually renders, and capture is covered by the packs-ready gate;
 *   · imgproc is not here: it is image processing, not STEM, and belongs to the
 *     @animspark/image plugin. To process pixels in a film, use python3 from bash (pillow is
 *     installed), write the result into assets, then reference it. The film entry does not
 *     export it, so importing it is an explicit, named compile error in anim check.
 *
 * film-build's stemFilmAliasPlugin and code-host's DEPS table both point here, so all three
 * render paths (product preview / capture export / node evaluation) see the same
 * '@animspark/stem'. They must not diverge.
 */
import { packComponent } from '@animspark/scene-engine/react';
export type { PackHandle as StemHandle } from '@animspark/scene-engine/react';

import { CODE_MORPH_DEF } from './code-morph';
import { EXECUTION_TRACE_DEF } from './execution-trace';
import { FORMULA_BRIDGE_DEF } from './formula';
import { MPL_FILM_DEF } from './mpl-film';

export const Formula = packComponent(FORMULA_BRIDGE_DEF);
export const CodeMorph = packComponent(CODE_MORPH_DEF);
export const ExecutionTrace = packComponent(EXECUTION_TRACE_DEF);
export const Mpl = packComponent(MPL_FILM_DEF);
