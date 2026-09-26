# Security

Please report security problems privately, not in a public issue: use
[**Report a vulnerability**](https://github.com/animspark/animspark/security/advisories/new) on GitHub,
or email **security@animspark.com**. Include what you found, how to reproduce it, and the version (`anim --version`
or the commit) you tested.

We will acknowledge the report, keep you updated while we fix it, and credit you in the
release notes if you would like.

## Scope

`anim` runs the film code in a workspace on your own machine, with your permissions: a
film's scenes are JavaScript executed by Node (to collect timing) and by Chromium (to draw).
Only run films you trust, as you would any other code. Reports about the engine doing
something a film's author could not expect — reading outside the workspace from `anim
preview`, serving files to other machines by default, and the like — are in scope.

## Known dependency advisories

- `@xmldom/xmldom` 0.9.10 (advisories fixed in 0.9.12) is pinned exactly by `speech-rule-engine`
  4.1.4, which MathJax (`mathjax-full`, used by `@animspark/stem` for formulas) depends on; no
  4.x release of it takes the fix yet. This repository overrides it to 0.9.12. In an npm install
  the pinned copy remains, but it only parses MathML that MathJax generates from a film's own
  LaTeX — input that is already trusted, since a film is code its author runs. To override it in
  your own project anyway, add `"overrides": { "@xmldom/xmldom": "^0.9.12" }` to your package.json.
