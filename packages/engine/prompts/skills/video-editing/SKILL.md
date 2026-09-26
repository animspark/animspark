---
name: video-editing
description: "Select, trim and rearrange source footage; build cuts, insert B-roll and arrange original sound. Use for making or revising a cut from existing media."
---

# Editing

Start by reading `assets/transcripts/<asset path>.vtt`: the whole transcript split into cues at pauses, with times in source seconds; the line above each cue says how long the pause before it is. To find a sentence across assets, use `rg -n "phrase" assets/transcripts`. For footage that has no transcript yet, run `anim audio asr --src <that file>` on the file itself (an AnimSpark Cloud command; it needs `anim login`). Video works the same way: the engine takes the audio track itself, so do not extract a separate audio file. Word timings attach to the file you transcribed, and the captions the engine derives and the cut check in `anim check` use that file. Narration already aligned by TTS/ASR does not need to be redone.

Put cuts in pauses: the out point keeps the tail of the sound and the in point keeps its onset. Transcribed word boundaries drift; `anim check` reports cuts that land inside actual sound and suggests a time for each.

Select, trim and reorder according to what the user wants to say. When selecting by speech, word times are for locating; keep complete utterances along with the references and causal links they need, and do not let a summary of a passage stand in for what the cut actually keeps. Before selecting and framing, look at the footage itself so you know which shots you have and who is speaking: `anim look` shows only the film, so either place the source on a video track and look at it there (`time` in source seconds maps to film time as below), or grab frames straight from the file with `ffmpeg -ss <source second> -i <file> -frames:v 1 <out>.png`.

## Cuts and placement

`time:[in,out]` selects an interval of the source, and `at` decides where that segment sits in the film; it occupies `out-in` seconds. For example, seconds 2–6 of one take followed by seconds 1–4 of another:

```json
{"stage":{"w":1920,"h":1080},"tracks":[
  {"kind":"video","clips":[
    {"id":"opening","src":"assets/video/take.mp4","at":0,"time":[2,6]},
    {"id":"detail","src":"assets/video/detail.mp4","at":4,"time":[1,4]}
  ]}
]}
```

Source second `s` corresponds to film second `at+s-in`. Changing a cut does not move the later clips automatically; when you reorder or shorten, adjust the placement of the following clips and of the elements that go with each shot. After cutting away excess, keep the breathing room and reaction time that are needed.

Joining two parts of the same shot is a jump cut, and the audience can tell something was removed. Select in whole sentences; cover the jump cuts you keep with B-roll, another camera angle or a slight push-in.

When the footage has burned-in subtitles, the captions the engine derives from the transcript would stack on them as a second layer: crop out or cover the original line.

When changing the aspect ratio, do not leave large black bars: with a single subject, crop to fill and keep it centered on the subject; with information on both sides, place the whole frame in the middle and put MG titles or key points in the empty space.

When changing the language, change the text in the picture as well (name tags, labels, title cards).

## Original sound and B-roll

Video carries its original sound by default; an ordinary cut keeps picture and sound together. When the sound runs across a picture cut (J/L cut), put the same MP4 on an audio track and arrange its `at/time` independently; set the matching video to `volume:0` so it does not play twice. There is no need to extract the audio first.

Put B-roll on a higher picture track, covering the main shot; if it only supplements the picture, mute it and keep the speech from the track below. Match the length of the cover to the content it illustrates.

Arrange music separately from the original sound, and let the music step back while people speak. When you need a fade in or out and the timeline has no volume-curve interface, make a derived audio file; keep the original asset.
