# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org);
every package in the repository is released together under one version.

## 0.1.0

The first public release.

- **Film format and engine.** `film.json` places clips of motion graphics (React + GSAP scenes),
  video and audio on tracks; the engine evaluates, compiles and renders it frame-exact with
  Chromium and ffmpeg. `anim new`, `check`, `look` (contact sheets, single frames, the sound
  mix), `render`, `clip` (single clips with alpha).
- **`anim preview`.** A read-only timeline player that follows every save: zoomable tracks with
  waveforms and filmstrips, frame stepping, in/out loops, an inspector that opens the source line
  in your editor, and a render button.
- **Music as code.** muspark scores render to audio locally with a General MIDI soundfont.
- **Fonts.** 200+ open-licensed Latin and CJK families load by name, fetched once and cached.
- **Skills.** `mg` and `video-editing`, plus the component skills `formula`, `sciplot`,
  `code-explainer` and `map`, installed into every workspace for Claude Code, Codex and Cursor.
- **Agents.** `CLAUDE.md` / `AGENTS.md` in every workspace; `anim mcp`, a local MCP server.
- **Media.** `anim login` connects AnimSpark Cloud for voice, sound effects, transcription, images
  and fonts, behind an open provider interface with OpenAI and ElevenLabs reference providers.
