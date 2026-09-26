# Full instrument list

Names are case-sensitive; use the names in these tables exactly. The 149 sampled names include aliases and variants; they are not 149 entirely different instruments. Synth voices are computed from oscillators; sampled voices are rendered from a General MIDI SoundFont. The first time a score uses a sampled voice, the engine downloads that SoundFont once, so the first render can take longer. What a sampled voice sounds like is determined by that SoundFont.

## How to choose

| Need | Channel fields |
| --- | --- |
| Basic synth voice | `instrument: 'piano'`; or explicitly `bank: 'synth'` |
| Sampled voice | `instrument: 'piano', bank: 'sampled'` |
| Synth preset | `instrument: 'synth-lead', voice: 'nes-pulse-25'` |
| Custom synth voice | `instrument: 'synth-lead', voice: myVoice`; see [sound design](../APIs/VoiceSpec.md) |
| Basic synth drums | `hits: [{ drum: 'kick', beat: 0 }]` |
| Sampled drums | `bank: 'sampled', hits: [{ drum: 'kick', beat: 0 }]` |
| Chip drums | `kit: 'chip', hits: [{ drum: 'chip-kick', beat: 0 }]` |

When `bank` is omitted, the 19 basic instruments and 9 basic drums below use the synth, and every other sampled name uses samples. `voice` replaces how the instrument makes sound but still needs a valid `instrument`; use `synth-lead` / `synth-pad` / `synth-bass` to state the role. Preset names go in `voice`, never in `instrument`. Neither `voice` nor `kit: 'chip'` can be combined with `bank: 'sampled'`. Drum channels take `hits`; melodic channels take `instrument` plus `notes/chords`.

## Basic synth instruments (19)

| Name | Sound / use |
| --- | --- |
| `piano` | short hammer attack, decaying harmonics; piano-style melody, broken chords |
| `electric-piano` | round electric piano, slight tremolo; soft harmony |
| `organ` | sustained harmonics, a rotary feel; organ chords |
| `guitar` | pick noise and fast decay; guitar-style plucking |
| `bass` | strong fundamental, soft decay; bass |
| `violin` | bowed fade-in, vibrato; high string melody |
| `cello` | slower fade-in, low string harmonics; cello-style melody |
| `strings` | soft fade-in, long release; string pad |
| `brass` | swelling harmonics, light saturation; brass accents |
| `saxophone` | reed harmonics; saxophone-style melody |
| `clarinet` | odd harmonics; clarinet-style melody |
| `marimba` | woody strike, fast decay; marimba figures |
| `synth-pad` | slow attack, long release; synth pad |
| `synth-lead` | stacked saw, pulse and sine; bright lead |
| `synth-bass` | sub-octave, saturated lows; synth bass |
| `pluck` | short attack, fast decay; plucked arpeggios |
| `bell` | non-integer overtones, long decay; bell accents |
| `flute` | mostly sine, light vibrato; soft flute |
| `choir` | slow fade-in, resonant harmonics; wordless choir pad |

## Synth presets (17)

These are synth configurations. NES / GB / SID name a sound style, not a full hardware emulation.

| Name | Sound / use |
| --- | --- |
| `nes-pulse-12` | 12.5% pulse; thin, sharp chip lead |
| `nes-pulse-25` | 25% pulse; classic chip melody |
| `nes-pulse-50` | square wave; full counter-melody or bass |
| `nes-triangle` | 4-bit triangle; chip bass |
| `nes-noise` | short-envelope noise; percussion and sound effects |
| `nes-pluck` | fast-decaying pulse; short pluck |
| `nes-fat-lead` | two detuned pulses; thickened lead |
| `gb-lead` | lowpassed 4-bit pulse; duller handheld lead |
| `gb-bass` | square plus sub-octave triangle; handheld bass |
| `gb-wave` | multiple harmonics, quantization and sample-and-hold; handheld wavetable style |
| `sid-lead` | saw and pulse, resonant filter; bright retro lead |
| `sid-bass` | pulse plus octave-down saw, lowpass; thick retro bass |
| `synthwave-bass` | detuned saw, sub-octave, saturation; retro synth bass |
| `synthwave-lead` | three detuned saws, vibrato; wide, thick lead |
| `synthwave-pad` | slow envelope, detuned saws; wide, thick pad |
| `acid-bass` | high resonance, fast filter envelope; acid bass sequences |
| `lofi-keys` | triangle, 6-bit quantization, sample-and-hold; grainy keys |

## Basic synth drums (9)

| Name | Sound |
| --- | --- |
| `kick` | downward-swept sine kick |
| `snare` | snare of noise layered with a drum body |
| `closed-hat` | short closed hi-hat |
| `open-hat` | longer open hi-hat |
| `clap` | clap of several noise bursts |
| `tom` | tom with a downward-swept body |
| `ride` | ride of metallic overtones layered with noise |
| `crash` | long-decaying noise crash |
| `shaker` | short high-frequency shaker |

## Chip drums (3)

| Name | Sound |
| --- | --- |
| `chip-kick` | fast downward-swept sine kick |
| `chip-snare` | quantized-noise snare |
| `chip-hat` | very short quantized-noise hat |

## Sampled instruments (149 names)

Names joined with `=` in the same cell are aliases for the same patch; variants are selected by the SoundFont bank.

| Family | Names and meaning |
| --- | --- |
| Piano | `piano` acoustic piano; `bright-piano` bright piano; `electric-grand` electric grand; `honky-tonk` honky-tonk piano; `electric-piano` electric piano; `fm-piano` FM electric piano; `harpsichord` harpsichord; `clavinet` clavinet |
| Chromatic percussion | `celesta` celesta; `glockenspiel` glockenspiel; `music-box` music box; `vibraphone` vibraphone; `marimba` marimba; `xylophone` xylophone; `bell` = `tubular-bells` tubular bells; `dulcimer` dulcimer |
| Organ | `drawbar-organ` drawbar organ; `percussive-organ` percussive organ; `rock-organ` rock organ; `organ` = `church-organ` church organ; `reed-organ` reed organ; `accordion` accordion; `harmonica` harmonica; `bandoneon` bandoneon |
| Guitar | `nylon-guitar` nylon-string; `guitar` = `steel-guitar` steel-string; `jazz-guitar` jazz; `clean-guitar` clean; `muted-guitar` muted; `overdrive-guitar` overdrive; `distortion-guitar` distortion; `guitar-harmonics` harmonics |
| Bass | `bass` = `acoustic-bass` acoustic bass; `finger-bass` fingered; `pick-bass` picked; `fretless-bass` fretless; `slap-bass` slap 1; `slap-bass-2` slap 2; `synth-bass` synth 1; `synth-bass-2` synth 2 |
| Strings | `violin` violin; `viola` viola; `cello` cello; `contrabass` contrabass; `tremolo-strings` tremolo strings; `pluck` = `pizzicato` pizzicato; `harp` harp; `timpani` timpani; `strings` string ensemble; `slow-strings` slow strings; `synth-strings` synth strings 1; `synth-strings-2` synth strings 2 |
| Voice | `choir` choir "aah"; `voice-oohs` choir "ooh"; `synth-voice` synth voice; `orchestra-hit` orchestra hit |
| Brass | `trumpet` trumpet; `trombone` trombone; `tuba` tuba; `muted-trumpet` muted trumpet; `french-horn` French horn; `brass` brass section; `synth-brass` synth brass 1; `synth-brass-2` synth brass 2 |
| Woodwinds | `soprano-sax` soprano sax; `saxophone` alto sax; `tenor-sax` tenor sax; `baritone-sax` baritone sax; `oboe` oboe; `english-horn` English horn; `bassoon` bassoon; `clarinet` clarinet; `piccolo` piccolo; `flute` flute; `recorder` recorder; `pan-flute` pan flute; `bottle-blow` blown bottle; `shakuhachi` shakuhachi; `whistle` whistle; `ocarina` ocarina |
| Synth lead | `synth-lead` = `square-lead` square; `saw-lead` saw; `calliope-lead` calliope; `chiff-lead` chiff; `charang-lead` charang; `voice-lead` voice; `fifths-lead` stacked fifths; `bass-lead` bass plus lead |
| Synth pad | `synth-pad` new age; `warm-pad` warm; `polysynth-pad` polysynth; `choir-pad` choir; `bowed-pad` bowed; `metal-pad` metallic; `halo-pad` halo; `sweep-pad` sweep |
| Synth effects | `fx-rain` rain; `fx-soundtrack` soundtrack; `fx-crystal` crystal; `fx-atmosphere` atmosphere; `fx-brightness` brightness; `fx-goblins` goblins; `fx-echoes` echoes; `fx-scifi` sci-fi |
| Ethnic | `sitar` sitar; `banjo` banjo; `shamisen` shamisen; `koto` koto; `kalimba` kalimba; `bagpipe` bagpipe; `fiddle` fiddle; `shenai` = `suona` shehnai-style double-reed voice (suona) |
| Pitched percussion | `tinkle-bell` tinkle bell; `agogo` agogo; `steel-drums` steel drums; `woodblock` woodblock; `taiko-drum` taiko drum; `melodic-tom` melodic tom; `synth-drum` synth drum; `reverse-cymbal` reverse cymbal |
| Sound effects | `fret-noise` guitar fret noise; `breath-noise` breath noise; `seashore` seashore; `birds` birds; `telephone` telephone; `helicopter` helicopter; `applause` applause; `gunshot` gunshot |
| Variants | `square-wave` square variant; `saw-wave` saw variant; `synth-bass-101` synth bass variant; `trumpet-2` trumpet variant; `trombone-2` trombone variant; `solo-french-horn` solo French horn; `brass-mono` mono brass; `strings-mono` mono strings; `slow-strings-mono` slow strings variant; `concert-choir` concert choir; `synth-mallet` synth mallet; `thunder` thunder; `wind` wind; `rain` rain |

## Sampled drums (47 names)

All of these go in a hit's drum field; a melodic instrument and a drum with the same name are told apart by the channel's structure.

| Type | Names and meaning |
| --- | --- |
| Kick | `kick` standard; `kick-soft` soft kick |
| Snare and clap | `snare` standard; `snare-electric` electric snare; `side-stick` side stick; `clap` clap |
| Hi-hat | `closed-hat` closed; `pedal-hat` pedal; `open-hat` open |
| Cymbals | `crash` crash 1; `crash-2` crash 2; `ride` ride; `ride-bell` ride bell; `splash` splash; `china` china |
| Toms | `tom` = `tom-mid` low tom; `tom-low` low floor tom; `tom-high` high tom; `tom-floor` high floor tom; `tom-hi-mid` low-mid tom; `tom-hi` hi-mid tom |
| Shakers and metal | `tambourine` tambourine; `cowbell` cowbell; `vibraslap` vibraslap; `shaker` = `maracas` maracas; `cabasa` cabasa; `triangle` triangle; `triangle-mute` muted triangle |
| Latin drums and bells | `conga-high` muted high conga (currently GM 62); `conga-mute` open high conga (currently GM 63); `conga-low` low conga; `bongo` high bongo; `bongo-low` low bongo; `timbale` high timbale; `timbale-low` low timbale; `agogo-high` high agogo; `agogo-low` low agogo |
| Other | `claves` claves; `wood-block` high woodblock; `wood-block-low` low woodblock; `cuica` cuica; `whistle` short whistle; `guiro` short guiro; `castanets` castanets; `surdo` surdo |

## Lookup constants

These are plain data, all imported from `@muspark/core`: `INSTRUMENTS`, `INSTRUMENT_DRUMS`, `CHIPTUNE_VOICE_NAMES`, `CHIPTUNE_VOICES`, `CHIPTUNE_DRUMS`, `SAMPLED_INSTRUMENTS`, `SAMPLED_DRUMS`. `SAMPLED_FAMILIES` is a common grouping; `SAMPLED_INSTRUMENTS` is the authoritative full list of names.
