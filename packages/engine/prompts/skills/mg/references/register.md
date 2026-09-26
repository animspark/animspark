# Deriving the visuals from the subject

On Cue is about the theatre, so it looks like a theatre. This reference covers what the same method looks like when applied to other subjects, and how to think this through before the first frame.

## Brief: six questions to answer before the first frame

Write the answers as a comment at the top of theme.ts. Every color, font and material after that is derived from it.

1. **Who watches, and in what setting.** A company profile is watched by clients and investors, a science piece by curious non-experts, a product film by people about to buy, a history film by people willing to sit for two minutes. The setting sets the tone: solemn, light, precise or lyrical. Pick only one.
2. **What exists in the subject's own world.** List the places, objects, materials, images and data it really has. An e-commerce platform has orders, parcels, storefronts, payments, a logistics network, financial figures and interfaces; a chemical reaction has molecules, bonds, an energy curve and a lab bench; a city history has maps, photographs, archives and a chronology. Take the picture only from this list, never borrow from other films.
3. **Where the palette comes from.** Brand colors (company, product), material colors (paper, metal, glass, earth), or discipline conventions (group colors of the periodic table, land and water colors on maps). One palette per film; theme.ts never contains a second primary color.
4. **Light or dark.** A dark stage is a property of the theatre, not of "premium". Information-heavy subjects default to bright and high contrast: a white or light brand background, large type, black or dark body text. Go dark only when the subject itself is in the dark (night sky, cinema, deep sea, a performance).
5. **Information forms.** Numbers as large type and charts at true proportions, networks as maps or node graphs, processes as timelines or flows, products as real interfaces or physical outlines, history as photographs and archives. Each form must be readable for its meaning within one second.
6. **What a professional studio would do.** Imagine the client is real: a studio takes on this subject; what would the sample it delivers look like? If the answer differs from what you are about to draw, change yours.

## Sample briefs

The same method (beats, word anchors, density, handoffs, sound-driven timelines) produces five different worlds for five subjects.

**Company profile (an e-commerce platform).** The audience is partners and investors; the tone is solemn and clear. World: order flows, parcels, storefront pages, payments, warehouses and trunk routes, annual-report figures. Palette: brand orange + white + deep charcoal, one accent color. Bright and high contrast. Information forms: the chronology as one timeline running through the whole film, scale as bars at true proportions and dot grids on a map, business units in the real layout of their interfaces. Type: a bold sans-serif for numbers, a neutral sans-serif for explanations. Motion: numbers roll into place, dot grids spread geographically, units slide out of the interface. No wooden floors, no spotlights, no paper cards.

**Science (a chemical reaction).** The audience is non-experts; the tone is light and precise. World: molecules, bonds, electron clouds, the energy curve, a lab bench and glassware. Palette: white background, conventional element colors (carbon dark gray, oxygen red, hydrogen white), one highlight color for the energy curve. Information forms: molecules drawn with real geometry, reaction progress traveling along the energy curve, temperature and time as scales. Motion: breaking bonds meet resistance, forming bonds spring back, and the peak of the curve is the high point of the beat.

**Product launch (a pair of headphones).** The audience is people about to buy; the tone is restrained and confident. World: the product's own outline, materials and buttons, the head and ears that wear it, sound waves. Palette: the product's actual colorway + one neutral background, with the background's lightness opposite to the product's color. Information forms: specs as large type with one comparison bar, structure as an exploded view, battery life as a progress bar that runs to the end. Motion: the camera circles the product, parts close up in assembly order, and each spec appears on the word where the narration names it.

**History (a hundred years of a city).** The audience is willing to slow down; the tone is lyrical but sourced. World: maps, old photographs, newspapers, archives, a chronology. Palette: paper and ink, one period accent color (such as stamp red); photographs keep their original color or all share one grade. Information forms: the map grows along the timeline, photographs carry their sources, numbers use the typefaces of their time. Motion: the map's streets are drawn one by one, photographs enter by a page turn or a push-in, and the chronology is the only element present throughout.

**Data report (one quarter's operations).** The audience is internal decision-makers; the tone is direct. World: tables, metrics, trends, composition. Palette: one dark and one light neutral + a color for up and a color for down. Information forms: every number gets a graphic at true proportions, the same metric uses the same kind of graphic throughout the film, and labels state units and definitions. Motion: bars grow from zero to their real values, lines travel along time to the present, and changes in composition transition by area rather than by cross-fade.

## Signs you borrowed from On Cue

If you see any of these, go back to the brief and start over:

- The world is dark and lit by a few lamps, while the subject is not in the dark.
- Wooden floors, curtains, spotlight cones, chalk, paper cards, red stamps or bulb marquees appear in a subject that is not theatre.
- Information is placed on "props" (slips of paper, cards, crates) instead of becoming the picture directly.
- The narration uses metaphors such as "stage", "entrance" or "curtain call" that the subject does not supply.
- Atmosphere layers such as fog, dust, light beams or vignettes: that is the air of a theatre. The subject has its own air (a lab is clean, a blueprint is paper); if it has none, add none.
- Copying On Cue's procedure instead of its method: the attack of sound effects made with `anim audio sfx` is already in index.jsonl, so there is no need to measure it again; if you do not draw sound, you do not need a narration envelope.
- Small, gray, low-contrast type, because that is all a dark stage allows.
- Charts out of proportion (one bar hits the ceiling and the rest are unreadable), because the chart was drawn as a prop.

## When borrowing from On Cue is right

- For every beat in the script, write see / understand / next; delete any beat whose see you cannot write.
- Every visible event hangs on a word anchor, and each is the cause of the next; set the number of events by what understanding requires.
- One world, one camera; the camera moves because the narration needs to look somewhere else.
- Scenes agree on camera positions and persistent elements, and pick them up with `tl.set(…, 0)`.
- Trim sound effects to their attack and lead the picture by 30 ms; music is data, and its section starts come from the cut points.
- Get assets with the `anim` asset commands or from the user's files under `assets/`, and treat the measured values in index.jsonl as authoritative.
