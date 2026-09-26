# Fonts

Families in the font library load by family name, with no import. Preview, `anim look` and `anim render` load every library family named in the source automatically (the engine downloads it on first use), so every machine renders the same fonts.

```tsx
<h1 style={{ fontFamily: "'Playfair Display', serif", fontWeight: 900 }}>Conservation of Energy</h1>
```

- Quote the family name and end the list with a generic family (`serif` / `sans-serif` / `monospace`). An unquoted family name that contains a digit (`Exo 2`) invalidates the whole declaration.
- Use only the weights listed in the table. For a weight that is not there, the browser substitutes the nearest one or synthesizes a fake bold.
- Family names outside the table (system fonts, names from memory) resolve to different fonts on different machines; `anim check` warns about them.
- Most Chinese, Japanese and Korean families include Latin glyphs. In mixed text, list the Latin family first and the CJK family after it; Latin characters then use the Latin family.

## Chinese

### Display

| Family | Weights | Style |
| --- | --- | --- |
| `Ma Shan Zheng` | 400 | Ma Shan Zheng brush kai — calligraphic inscriptions, Chinese traditional style |
| `ZCOOL KuaiLe` | 400 | ZCOOL KuaiLe — lively and rounded; fun and kids headlines |
| `ZCOOL QingKe HuangYou` | 400 | ZCOOL QingKe HuangYou — chunky rounded poster face |
| `ZCOOL XiaoWei` | 400 | ZCOOL XiaoWei — thin, literary headlines |
| `得意黑` / `Smiley Sans` / `Smiley Sans Oblique` | 400 | Smiley Sans — narrow, slanted modern gothic; the go-to for variety-show captions and sports headlines |
| `霞鹜漫黑` / `LXGW Marker Gothic` | 400 | LXGW Marker Gothic — marker POP face; variety-show lettering, handmade signage |

### Body

| Family | Weights | Style |
| --- | --- | --- |
| `Cactus Classical Serif` | 400 | Cactus Classical Serif — Traditional Chinese classical ming |
| `Chocolate Classical Sans` | 400 | Chocolate Classical Sans — Traditional Chinese screen gothic |
| `LXGW WenKai` | 300 500 700 | LXGW WenKai — warm handwritten kai; humanist, essays, subtitles |
| `LXGW WenKai TC` | 400 700 | LXGW WenKai TC — Traditional Chinese humanist kai, subtitles |
| `Noto Sans SC` | 400 500 700 900 | Source Han Sans — modern and neutral; body text, UI, general headlines |
| `Noto Serif SC` | 400 600 900 | Source Han Serif — bookish serif; documentaries, culture, large headlines |
| `寒蝉全圆体` / `ChillRound` / `Chill Round` | 400 700 | ChillRound — soft rounded face; cute, soft tech, friendly UI |
| `小赖字体` / `Xiaolai SC` / `Xiaolai` / `小濑字体` / `Kose` | 400 | Xiaolai — neat handwriting that works as body text (unlike the playfulness of Yozai) |
| `朱雀仿宋` / `Zhuque Fangsong` | 400 | Zhuque Fangsong — refined fangsong; official documents, quotations, classical annotations |
| `汇文明朝体` / `Huiwen-mincho` / `Huiwen Mincho` | 400 | Huiwen Mincho — letterpress mincho style; vintage print, literary titles |

### Monospace

| Family | Weights | Style |
| --- | --- | --- |
| `Maple Mono CN` / `MapleMono CN` / `等距更纱` / `Maple Mono` | 400 700 | Chinese-Latin monospace — code, tables and aligned numbers in Chinese films |

### Accent (short labels only; as body text it blurs)

| Family | Weights | Style |
| --- | --- | --- |
| `Liu Jian Mao Cao` | 400 | Liu Jian Mao Cao — wild cursive strokes; emotional outbursts |
| `Long Cang` | 400 | Long Cang — thin pen handwriting; notebook feel |
| `Zhi Mang Xing` | 400 | Zhi Mang Xing — flowing running-script handwriting |
| `悠哉字体` / `Yozai` / `悠哉` | 400 700 | Yozai — rounded, playful handwriting; comforting, everyday jottings |

## Latin

### Display

| Family | Weights | Style |
| --- | --- | --- |
| `Abel` | 400 | Light condensed — minimal headlines |
| `Abril Fatface` | 400 | Ultra-bold poster serif — vintage billboard |
| `Alfa Slab One` | 400 | Ultra-bold slab — circus, vintage signage |
| `Anton` | 400 | Heavy, compact impact headline |
| `Archivo Black` | 400 | Extra-black headline — street posters |
| `Archivo Narrow` | 400 700 | Condensed face for body text and headlines — reports, annual reports |
| `Audiowide` | 400 | Wide cyber face — esports, in-car UI |
| `Barlow Condensed` | 400 600 | Condensed sport face — athletics, sense of speed |
| `Bebas Neue` | 400 | Tall, narrow all-caps impact headline |
| `Bevan` | 400 | Bold slab display — old-fashioned billboards |
| `Bodoni Moda` | 400 700 900 | Modern Bodoni — fashion, luxury |
| `Bowlby One` | 400 | Heavy square-shouldered face — designer toys, posters |
| `Bricolage Grotesque` | 400 600 800 | Characterful editorial face — magazines, culture |
| `Bungee` | 400 | Street signage face — works set vertically |
| `Chakra Petch` | 400 700 | Chamfered HUD face — instrument UI, Thai tech |
| `Cinzel` | 400 700 | Roman inscription face — epic, memorial, wine labels |
| `Cinzel Decorative` | 400 700 | Ornamented Roman face — fantasy, heraldry |
| `Cormorant Garamond` | 400 600 700 | Delicate classical serif — poetic, literary |
| `DM Serif Display` | 400 | High-contrast, elegant display serif |
| `Electrolize` | 400 | Digital-watch face — data, terminals |
| `Exo 2` | 400 700 | Modern tech sans — aerospace, product |
| `Fjalla One` | 400 | Condensed headline — news headlines |
| `Fraunces` | 600 900 | Vintage soft-serif display; old-style print, coffee, handmade |
| `Fugaz One` | 400 | Bold italic headline — speed, promos |
| `Gilda Display` | 400 | Elegant fine serif — boutique, invitations |
| `Instrument Serif` | 400 | Small, fresh display serif — design-studio feel |
| `Italiana` | 400 | Thin, tall serif — haute couture, gallery |
| `Josefin Slab` | 400 700 | Art Deco slab — 1920s retro |
| `Kanit` | 400 700 | Thai-style sans — sport, street |
| `Lilita One` | 400 | Rounded bold headline — light entertainment |
| `Luckiest Guy` | 400 | Comic-book bold — humor, stickers |
| `Marcellus` | 400 | Classical Roman face — museums, refined |
| `Michroma` | 400 | Space-age wide face — aerospace, industrial |
| `Modak` | 400 | Balloon-fat face — desserts, playful |
| `Monoton` | 400 | Neon line display — disco, retro electric |
| `Nova Square` | 400 | Blocky pixel-like display — retro sci-fi |
| `Orbitron` | 400 700 900 | Sci-fi geometric face — spaceship instruments |
| `Oswald` | 400 600 | Condensed news headline |
| `Outfit` | 400 600 900 | Clean geometric sans — brand, posters |
| `Passion One` | 400 700 | Heavy round-terminal headline — promos, sports |
| `Playfair Display` | 400 700 900 | Didone headline — magazine, luxury, editorial |
| `Prata` | 400 | High-contrast Didone — fashion and beauty headlines |
| `Quantico` | 400 700 | Military-spec square face — tactical, military |
| `Rajdhani` | 400 700 | Hard-edged HUD face — instruments, defense industry |
| `Righteous` | 400 | Rounded display face — trendy, entertainment |
| `Rozha One` | 400 | Very high-contrast serif — impact headlines |
| `Russo One` | 400 | Mecha sport face — racing, military |
| `Saira` | 400 700 | Wide tech sans — industrial, racing |
| `Saira Condensed` | 400 700 | Condensed tech — sports events, leaderboards |
| `Shrikhand` | 400 | Indian signage bold italic — festive, spices |
| `Sigmar One` | 400 | Bold with a 3D feel — retro games |
| `Space Grotesk` | 500 700 | Geometric sans display; tech, contemporary |
| `Staatliches` | 400 | Tall, narrow all caps — exhibition posters |
| `Syncopate` | 400 700 | Extra-wide tracking display — fashion tech |
| `Syne` | 400 700 800 | Artsy avant-garde sans — gallery, experimental |
| `Teko` | 400 700 | Compressed tall face — scoreboards, gauges |
| `Titan One` | 400 | Cartoon bold — kids, games |
| `Tomorrow` | 400 700 | Near-future sans — concept products |
| `Ultra` | 400 | Ultra-bold slab — Wild West, circus |
| `Unbounded` | 400 700 900 | Expanded futuristic face — crypto, space |
| `Yanone Kaffeesatz` | 400 700 | Hand-drawn condensed — cafe menus |
| `Yeseva One` | 400 | Heavy decorative serif — vintage posters |
| `Young Serif` | 400 | Chunky vintage serif — warm, handmade feel |

### Body

| Family | Weights | Style |
| --- | --- | --- |
| `Alegreya` | 400 700 | Humanist serif — bookish warmth |
| `Aleo` | 400 700 | Contemporary slab — brand body text |
| `Archivo` | 400 600 900 | News grotesque — strong headlines |
| `Arvo` | 400 700 | Geometric slab — chart labels, body text |
| `Be Vietnam Pro` | 400 700 | Modern sans — multilingual body text |
| `Bitter` | 400 700 | Slab for body text — solid, dependable |
| `Crete Round` | 400 | Rounded slab — gentle explanations |
| `Crimson Pro` | 400 700 | Classical book serif — literature, essays |
| `DM Sans` | 400 700 900 | Neutral low-contrast sans — UI, body text |
| `Domine` | 400 700 | Body serif — optimized for web reading |
| `EB Garamond` | 400 600 800 | Old-style Garamond — history, academia |
| `Epilogue` | 400 700 | Neutral variable sans — modern brand |
| `Figtree` | 400 700 | Friendly geometric sans — product and brand body text |
| `Frank Ruhl Libre` | 400 700 | Modern Hebrew-style serif — clear, works for headlines and body text |
| `Hanken Grotesk` | 400 700 | Neutral grotesk — general body text |
| `IBM Plex Sans` | 400 700 | IBM engineering sans — technical documentation |
| `Inter` | 400 600 | Neutral body text and UI |
| `Karla` | 400 700 | Grotesque sans — indie magazine flavor |
| `Lexend` | 400 600 | Highly legible sans — education, accessibility |
| `Libre Baskerville` | 400 700 | Bookish body serif — print publications |
| `Literata` | 400 700 | E-book serif — optimized for screen reading |
| `Lora` | 400 600 700 | Modern body serif — blogs, long reads |
| `Manrope` | 400 600 800 | Modern rounded geometric sans — product, brand |
| `Mulish` | 400 700 | Minimal rounded sans — clean UI |
| `Newsreader` | 400 700 | News serif — newsroom character |
| `Onest` | 400 700 | Contemporary geometric sans — tech brand |
| `Petrona` | 400 700 | Fine-necked serif — magazine body text |
| `Plus Jakarta Sans` | 400 600 800 | Brand-minded humanist sans |
| `Public Sans` | 400 700 | Neutral government sans — public data, explanations |
| `Roboto Condensed` | 400 700 | Neutral condensed — dense information, captions |
| `Roboto Slab` | 400 700 | Neutral slab — document headings and body text |
| `Rokkitt` | 400 700 | Slender slab — crisp labels |
| `Rubik` | 400 700 | Rounded geometric sans — youthful, friendly |
| `Schibsted Grotesk` | 400 700 | Nordic news sans — reportage, charts |
| `Sora` | 400 600 800 | Geometric tech sans — Web3, cutting edge |
| `Source Sans 3` | 400 700 | General-purpose UI sans — docs, dashboards |
| `Source Serif 4` | 400 700 | General-purpose body serif — solid and neutral, first choice for long text |
| `Spectral` | 400 700 | Screen serif — calm and restrained; reportage, long reads |
| `Vollkorn` | 400 700 | Sturdy German-style serif — textbooks, manuals |
| `Work Sans` | 400 600 900 | General-purpose grotesque sans — works for posters and body text |
| `Zilla Slab` | 400 600 | Modern slab — tech with a humanist touch |

### Monospace

| Family | Weights | Style |
| --- | --- | --- |
| `Azeret Mono` | 400 700 | Hard-edged monospace — design-minded data |
| `Courier Prime` | 400 700 | Screenplay typewriter monospace — Hollywood scripts |
| `DM Mono` | 400 500 | Light, clean monospace |
| `Fira Code` | 400 600 | Code monospace with ligatures |
| `Geist Mono` | 400 700 | Contemporary product monospace — developer tools |
| `IBM Plex Mono` | 400 600 | Engineering monospace — industrial blueprint feel |
| `Inconsolata` | 400 700 | Compact code monospace — dense code |
| `JetBrains Mono` | 500 700 | Monospace; code, data, terminals |
| `Martian Mono` | 400 700 | Wide monospace — data tables, dashboards |
| `Overpass Mono` | 400 700 | Monospace derived from highway signage — labels, numbering |
| `Red Hat Mono` | 400 700 | Open-source engineering monospace — config, terminals |
| `Roboto Mono` | 400 700 | Neutral code monospace — terminals, logs |
| `Source Code Pro` | 400 700 | General-purpose code monospace — reliably readable |
| `Space Mono` | 400 700 | Grotesque monospace — magazine-style code and data |
| `Spline Sans Mono` | 400 700 | Light monospace — comments, metadata |

### Accent (short labels only; as body text it blurs)

| Family | Weights | Style |
| --- | --- | --- |
| `Allura` | 400 | Elegant connected script — certificates, weddings |
| `Amatic SC` | 400 700 | Tall, thin handwritten all caps — arty posters |
| `Architects Daughter` | 400 | Architect handwriting — blueprint annotations |
| `Bungee Shade` | 400 | 3D shadow signage face — neon posters |
| `Caveat` | 400 700 | Casual handwritten annotations |
| `Caveat Brush` | 400 | Brush handwriting — short emphatic phrases |
| `Courgette` | 400 | Rounded brush — warm headlines |
| `Covered By Your Grace` | 400 | Slanted handwriting — personal notes |
| `Creepster` | 400 | Dripping horror face — Halloween, thrillers |
| `Dancing Script` | 400 700 | Flowing connected script — invitations, romance |
| `Faster One` | 400 | Speed-line decorative face — racing |
| `Gloria Hallelujah` | 400 | Childlike handwriting — playful annotations |
| `Great Vibes` | 400 | Elegant English script — weddings, certificates |
| `Handjet` | 400 700 | Variable dot-matrix face — LED, industrial printing |
| `Homemade Apple` | 400 | Fountain-pen hand — letters, signatures |
| `Indie Flower` | 400 | Rounded handwriting — casual notes |
| `Jersey 10` | 400 | Jersey dot-matrix face — scoreboards |
| `Just Another Hand` | 400 | Slender handwriting — labels, next to arrows |
| `Kalam` | 400 700 | Marker handwriting — whiteboard explainers |
| `Lobster` | 400 | Classic brush headline — restaurants, markets |
| `Major Mono Display` | 400 | Lowercase monoline mono display — geek posters |
| `Marck Script` | 400 | Thin connected handwriting — signature feel |
| `Nothing You Could Do` | 400 | Dense handwriting — diary, letters |
| `Pacifico` | 400 | Retro surf brush script |
| `Parisienne` | 400 | French script — fragrance, boutique |
| `Patrick Hand` | 400 | Neat handwriting — class notes |
| `Permanent Marker` | 400 | Thick permanent marker — graffiti, slogans |
| `Pirata One` | 400 | Gothic blackletter — medieval, metal |
| `Pixelify Sans` | 400 700 | Modern pixel face — indie game UI |
| `Press Start 2P` | 400 | 8-bit arcade pixel |
| `Reenie Beanie` | 400 | Thin-pen handwriting — quick scribbles |
| `Rock Salt` | 400 | Rough chalk handwriting — street, handmade |
| `Rye` | 400 | Western wanted-poster face — Old West |
| `Sacramento` | 400 | Thin connected script — invitations, sign-offs |
| `Satisfy` | 400 | Lively brush — desserts, handmade |
| `Shadows Into Light` | 400 | Delicate handwriting — notes, diary |
| `Silkscreen` | 400 700 | Small-size pixel face — low-resolution UI |
| `Special Elite` | 400 | Old typewriter — archives, detective |
| `UnifrakturMaguntia` | 400 | Pointed German Gothic — old books, beer |
| `VT323` | 400 | CRT terminal monospace — hacker, DOS |
| `Yellowtail` | 400 | Retro brush italic — signage, food and drink |

## Japanese

### Display

| Family | Weights | Style |
| --- | --- | --- |
| `Dela Gothic One` | 400 | Ultra-bold gothic — impact headlines, magazine covers |
| `Hina Mincho` | 400 | Thin mincho — Japanese-style white space, premium feel |
| `Kaisei Decol` | 400 700 | Decorative mincho — vintage trademarks |
| `M PLUS Rounded 1c` | 400 500 800 | Maru gothic — friendly rounded headlines |
| `Potta One` | 400 | Rounded bold — food, family |
| `Rampart One` | 400 | 3D embossed face — posters, game titles |
| `Reggae One` | 400 | Reggae bold — music, parties |
| `Train One` | 400 | Railway signage face — transport, retro Showa |
| `Yuji Syuku` | 400 | Brush kai — Japanese-style inscriptions |

### Body

| Family | Weights | Style |
| --- | --- | --- |
| `BIZ UDGothic` | 400 700 | Universal Design gothic — textbooks, accessibility |
| `BIZ UDMincho` | 400 700 | Universal Design mincho — official documents, textbooks |
| `Kiwi Maru` | 400 | Gentle rounded face — picture books, comforting |
| `Noto Sans JP` | 400 500 700 900 | Modern gothic — neutral sans |
| `Noto Serif JP` | 400 600 900 | Mincho — serif with a literary, documentary character |
| `Shippori Mincho` | 400 700 | Traditional mincho — Japanese body text, vertical literature |
| `Zen Kaku Gothic New` | 400 700 | Modern kaku gothic — UI, explanations |
| `Zen Maru Gothic` | 400 500 700 | Warm rounded face — soft body text and headlines |
| `Zen Old Mincho` | 400 700 | Classical mincho — history, documentary |

### Accent (short labels only; as body text it blurs)

| Family | Weights | Style |
| --- | --- | --- |
| `DotGothic16` | 400 | Pixel dot matrix — retro games, terminals |
| `Hachi Maru Pop` | 400 | Rounded girly POP — journals, stickers |
| `Stick` | 400 | Minimal thin-line face — icon labels |
| `Yusei Magic` | 400 | Marker handwriting — chalkboard, doodles |

## Korean

### Display

| Family | Weights | Style |
| --- | --- | --- |
| `Bagel Fat One` | 400 | Fat rounded display — trendy, desserts |
| `Black Han Sans` | 400 | Ultra-bold impact headline — posters, variety shows |
| `Do Hyeon` | 400 | Geometric headline face — crisp and decisive |
| `Gasoek One` | 400 | Ultra-bold impact face — promos, banners |
| `Jua` | 400 | Rounded cute face — kids, snacks |
| `Song Myung` | 400 | Classical myeongjo — history, tradition |

### Body

| Family | Weights | Style |
| --- | --- | --- |
| `42dot Sans` | 400 700 | Modern geometric gothic — tech brand |
| `Gowun Batang` | 400 700 | Gowun Batang — soft serif for body text |
| `Gowun Dodum` | 400 | Gentle and rounded — soft storytelling |
| `Hahmlet` | 400 700 | Modern serif — editorial design |
| `Nanum Gothic` | 400 700 | Nanum Gothic — general-purpose Korean gothic for body text |
| `Nanum Myeongjo` | 400 700 | Nanum Myeongjo — Korean myeongjo for body text, literature |
| `Noto Sans KR` | 400 500 700 900 | Modern gothic — neutral body text and headlines |
| `Noto Serif KR` | 400 600 900 | Serif myeongjo — bookish |

### Accent (short labels only; as body text it blurs)

| Family | Weights | Style |
| --- | --- | --- |
| `Dongle` | 400 700 | Thin rounded handwriting — casual labels |
| `Gaegu` | 400 700 | Pencil handwriting — classroom, notes |
| `Gamja Flower` | 400 | Playful handwriting — doodles, diary |
| `Nanum Pen Script` | 400 | Pen handwriting — diary, notes |
