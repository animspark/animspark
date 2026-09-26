/**
 * "How many seconds this job paid for" — the tolerance is defined here, once.
 *
 * Two readers use it: the check decides pass/fail with it (briefDuration), and the opening brief
 * tells the agent where the limits are (durationLines). With a copy in each, the brief's tolerance
 * would sooner or later drift looser than what the check enforces, and the agent would learn the
 * real limit only by following the brief and then failing the check.
 *
 * 10% slack with a 1s floor: cutting 24.6s against a 25s target is a normal ending, not an error;
 * but 10% of a 5s film is 0.5s, tighter than frame-level alignment, and no film lands in it reliably.
 */
import type { CodeIssue } from '@animspark/film-build';

/** Allowed deviation from the target length (seconds). */
export function durationSlackSec(wantedSec: number): number {
  return Math.max(1, wantedSec * 0.1);
}

/** Allowed film length range (seconds, inclusive). */
export function durationBandSec(wantedSec: number): { lo: number; hi: number } {
  const slack = durationSlackSec(wantedSec);
  return { lo: wantedSec - slack, hi: wantedSec + slack };
}

export interface DurationContract {
  /** Seconds this job asks for (`durationSec` in task.json). */
  wantedSec?: number;
  /**
   * Whether that number is a contract or a suggestion.
   *
   * Contract (the hosted API, billed per second): out of range is an error — `anim check` fails
   * and the agent can't deliver. Suggestion (the web app): out of range is a warning — delivering
   * 52s for "about a minute" hurts no one, and padding with content just to round it out is worse.
   */
  strict?: boolean;
  /** Actual film length (seconds). */
  gotSec: number;
}

/**
 * Is the length right? Within tolerance there's nothing to say (return an empty array, not an info
 * line — every extra line in the check report makes the lines that matter less likely to be seen).
 */
export function durationIssues(c: DurationContract): CodeIssue[] {
  const wanted = c.wantedSec;
  if (!wanted || wanted <= 0) return [];
  const { lo, hi } = durationBandSec(wanted);
  if (c.gotSec >= lo && c.gotSec <= hi) return [];
  const short = c.gotSec < wanted;
  const off = `${short ? 'Short' : 'Long'} by ${Math.abs(c.gotSec - wanted).toFixed(1)}s`;
  const head = `This film runs ${c.gotSec.toFixed(1)}s and the job asked for ${wanted}s (task.json). ${off}`;
  if (!c.strict) return [{ level: 'warn', what: head }];
  /* In strict mode, also say which way to fix it. An error that only says "wrong" buys a round of
     guessing — and the laziest guess (stretching a static frame to fill time) yields a useless
     film, so it is ruled out by name here. */
  return [{
    level: 'error',
    what: `${head}. This job's length is contractual, so ${wanted}s is not a suggestion: `
      + `land inside ${lo.toFixed(1)}s-${hi.toFixed(1)}s. `
      + `${short ? 'Extend or add scenes' : 'Trim or tighten scenes'} — `
      + 'do not pad or trim by stretching a static hold.',
  }];
}
