/**
 * Puts the Chrome Origin Trial token on film pages.
 *
 * html-in-canvas is currently a trial (Chrome 148–154). `anim look` / export already enable it with a
 * Blink flag; a regular browser has no flag and needs this token. The token **must be on the document
 * that draws the canvas**, which in the preview is the iframe (`/film/host`). Putting it on the outer
 * shell page does nothing: Origin Trials are matched by document origin and don't reach into the
 * iframe. Tokens are issued per origin (https://developer.chrome.com/origintrials); set
 * HTML_IN_CANVAS_ORIGIN_TRIAL when deploying the preview yourself.
 *
 * It's public by nature (it's in every page's HTML), not a secret. Empty = not injected; films that
 * can't detect the API fall back to DOM rendering.
 */

export function originTrialToken(raw = process.env.HTML_IN_CANVAS_ORIGIN_TRIAL): string {
  const token = raw?.trim() ?? '';
  /* Reject characters that could break out of the meta tag. Tokens are base64url and normally
     contain no whitespace or quotes. */
  if (!token || token.length < 40 || /["<>\s]/.test(token)) return '';
  return token;
}

export function originTrialMetaTag(token = originTrialToken()): string {
  return token ? `<meta http-equiv="origin-trial" content="${token}">\n` : '';
}

export function originTrialResponseHeaders(token = originTrialToken()): Record<string, string> {
  return token ? { 'origin-trial': token } : {};
}
