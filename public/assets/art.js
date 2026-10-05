// Product illustrations. Each is a 160×120 drawing coloured by the item's
// tone through CSS variables (.tone-* in styles.css), so one drawing serves
// every brand. Real photos replace them when an item has an image URL.
//
// These strings are static and authored here; they are the only markup this
// app ever assigns with innerHTML.

const shadow = (cx = 80, rx = 46) => `<ellipse class="shadow" cx="${cx}" cy="108" rx="${rx}" ry="5"/>`;

// The little mango-and-leaf mark that stands in for a logo on merchandise.
function mark(cx, cy, r) {
  const k = (n) => (n * r).toFixed(1);
  return `<circle class="p" cx="${cx}" cy="${cy}" r="${r}"/>
<ellipse class="d" cx="${cx}" cy="${(cy + r * 0.14).toFixed(1)}" rx="${k(0.46)}" ry="${k(0.55)}" transform="rotate(-22 ${cx} ${cy})"/>
<path class="m" d="M${cx} ${(cy - r * 0.38).toFixed(1)}q${k(0.3)} ${k(-0.42)} ${k(0.62)} ${k(-0.3)}q${k(-0.22)} ${k(0.36)} ${k(-0.62)} ${k(0.3)}Z"/>`;
}

const ART = {
  tee: `${shadow()}
<path class="m" d="M62 18 46 23 26 40l12 16 11-7v53h62V49l11 7 12-16-20-17-16-5c-3 8-10 12-18 12s-15-4-18-12Z"/>
<path class="d" d="M62 18c3 8 10 12 18 12s15-4 18-12l-5-2c-2 6-7 9-13 9s-11-3-13-9Z"/>
${mark(80, 60, 13)}`,

  polo: `${shadow()}
<path class="m" d="M62 18 46 23 26 40l12 16 11-7v53h62V49l11 7 12-16-20-17-16-5c-3 8-10 12-18 12s-15-4-18-12Z"/>
<path class="p" d="M60 17 80 34l20-17-7-3-13 11-13-11Z"/>
<rect class="d" x="77" y="33" width="6" height="20" rx="2"/>
<circle class="p" cx="80" cy="39" r="1.6"/><circle class="p" cx="80" cy="46" r="1.6"/>
${mark(99, 56, 7)}`,

  cap: `${shadow(78, 50)}
<path class="m" d="M36 80c0-28 19-46 44-46s44 18 44 46Z"/>
<path class="od" d="M80 36v42M58 44c-6 10-8 22-8 34M102 44c6 10 8 22 8 34"/>
<circle class="d" cx="80" cy="34" r="4"/>
<path class="d" d="M28 80h104c9 0 14 4 14 9s-5 7-14 7H50c-14 0-22-6-22-16Z"/>
${mark(80, 62, 11)}`,

  apron: `${shadow()}
<path class="o" d="M64 26c0-14 32-14 32 0"/>
<path class="o" d="M46 52 28 62M114 52l18 10"/>
<path class="m" d="M62 24h36l4 20 14 4v52c0 4-3 6-6 6H50c-3 0-6-2-6-6V48l14-4Z"/>
<rect class="d" x="58" y="74" width="44" height="22" rx="4"/>
<path class="op" d="M80 76v18"/>
${mark(80, 52, 9)}`,

  rocks: `${shadow(80, 38)}
<path class="p" d="M50 32h60l-6 66c0 4-3 7-7 7H63c-4 0-7-3-7-7Z"/>
<path class="m" d="M53 60h54l-3.6 38c0 3-2 5-5 5H61.6c-3 0-5-2-5-5Z"/>
<rect class="p" x="63" y="50" width="20" height="20" rx="4" opacity=".85" transform="rotate(-12 73 60)"/>
<path class="o" d="M50 32h60l-6 66c0 4-3 7-7 7H63c-4 0-7-3-7-7Z"/>
<circle class="d" cx="109" cy="33" r="12"/><circle class="s" cx="109" cy="33" r="8.5"/>
<path class="ot" d="M109 25v16M101 33h16"/>`,

  shot: `${shadow(80, 50)}
<path class="p" d="M38 46h32l-4 52c0 3-2 5-5 5H47c-3 0-5-2-5-5Z"/>
<path class="m" d="M40.4 66h27.2l-2.6 32c0 2-1 3-3 3H46c-2 0-3-1-3-3Z"/>
<path class="o" d="M38 46h32l-4 52c0 3-2 5-5 5H47c-3 0-5-2-5-5Z"/>
<path class="p" d="M90 40h32l-4 58c0 3-2 5-5 5H99c-3 0-5-2-5-5Z"/>
<path class="d" d="M92.4 62h27.2l-3 36c0 2-1 3-3 3H98.4c-2 0-3-1-3-3Z"/>
<path class="o" d="M90 40h32l-4 58c0 3-2 5-5 5H99c-3 0-5-2-5-5Z"/>`,

  glencairn: `${shadow(80, 34)}
<path class="p" d="M68 16h24c0 12 9 20 9 38 0 15-9 24-21 24s-21-9-21-24c0-18 9-26 9-38Z"/>
<path class="m" d="M59.6 58h40.8c-1.4 12-9.4 19-20.4 19s-19-7-20.4-19Z"/>
<path class="o" d="M68 16h24c0 12 9 20 9 38 0 15-9 24-21 24s-21-9-21-24c0-18 9-26 9-38Z"/>
<path class="p" d="M75 78h10v18H75Z"/><path class="o" d="M75 78v18M85 78v18"/>
<ellipse class="p" cx="80" cy="100" rx="22" ry="6"/><ellipse class="o" cx="80" cy="100" rx="22" ry="6"/>`,

  tumbler: `${shadow(80, 32)}
<path class="od" d="M90 22 97 4"/>
<rect class="d" x="55" y="20" width="50" height="11" rx="4"/>
<path class="m" d="M58 31h44l-5 70c0 3-2 5-5 5H68c-3 0-5-2-5-5Z"/>
<path class="s" d="M59.2 46h41.6l-.8 10H60Z"/>
${mark(80, 78, 11)}`,

  "shelf-talker": `${shadow(80, 58)}
<path class="s" d="M34 12h10v8c0 3 6 5 6 12v18H28V32c0-7 6-9 6-12Z"/>
<path class="s" d="M112 12h10v8c0 3 6 5 6 12v18h-22V32c0-7 6-9 6-12Z"/>
<rect class="i" x="16" y="48" width="128" height="9" rx="2"/>
<rect class="d" x="73" y="54" width="14" height="9" rx="2"/>
<g transform="rotate(-4 80 82)">
<rect class="m" x="50" y="60" width="60" height="46" rx="6"/>
<path class="op" d="M60 72h26M60 80h34M60 88h18"/>
<rect class="p" x="92" y="84" width="12" height="12" rx="2"/>
</g>`,

  "neck-hanger": `${shadow(80, 30)}
<path class="s" d="M70 14h20v22c0 6 16 12 16 28v42H54V64c0-16 16-22 16-28Z"/>
<rect class="d" x="68" y="8" width="24" height="12" rx="3"/>
<ellipse class="o" cx="80" cy="32" rx="12" ry="4"/>
<g transform="rotate(9 90 60)">
<path class="m" d="M76 34h30l6 9v45c0 3-2 5-5 5H81c-3 0-5-2-5-5Z"/>
<circle class="p" cx="91" cy="43" r="3.5"/>
<path class="op" d="M83 58h22M83 66h16M83 74h20"/>
</g>`,

  "table-tent": `${shadow(80, 46)}
<path class="d" d="M60 102 78 26h8l22 76Z"/>
<path class="m" d="M38 104 66 24h20l-6 80Z"/>
<path class="p" d="M50 52h26l-13 14Z"/>
<path class="op" d="M63 66v12M56 80h14"/>
<path class="op" d="M48 92h26"/>`,

  "bar-mat": `${shadow(80, 64)}
<rect class="m" x="14" y="42" width="132" height="40" rx="9"/>
<rect class="d" x="21" y="49" width="118" height="26" rx="5"/>
${Array.from({ length: 3 }, (_, r) =>
  Array.from({ length: 14 }, (_, c) => `<circle class="s" cx="${28 + c * 8.4}" cy="${55 + r * 7}" r="1.8"/>`).join("")
).join("")}`,

  neon: `${shadow(80, 56)}
<path class="o" d="M48 26 58 8M112 26l-10-18"/>
<rect class="i" x="20" y="24" width="120" height="70" rx="12"/>
<path class="glow" d="M44 72c4-24 22-30 28-12 4 12 10 12 14-2M98 44v30M98 59h16M114 44v30"/>
<path class="om" d="M44 72c4-24 22-30 28-12 4 12 10 12 14-2M98 44v30M98 59h16M114 44v30"/>`,

  "tin-sign": `${shadow(80, 56)}
<rect class="m" x="24" y="20" width="112" height="80" rx="6"/>
<rect class="od" x="31" y="27" width="98" height="66" rx="4"/>
<circle class="d" cx="32" cy="28" r="2.5"/><circle class="d" cx="128" cy="28" r="2.5"/>
<circle class="d" cx="32" cy="92" r="2.5"/><circle class="d" cx="128" cy="92" r="2.5"/>
<path class="d" d="M80 36l18 10v20l-18 10-18-10V46Z"/>
<path class="op" d="M72 56h16"/>
<path class="d" d="M46 82h68v6H46Z"/>`,

  shaker: `${shadow(80, 46)}
<path class="s" d="M84 30h34l-5 74H89Z"/>
<path class="o" d="M84 30h34l-5 74H89Z"/>
<g transform="rotate(-9 64 52)">
<path class="m" d="M48 18h32l-4 62H52Z"/>
<path class="o" d="M48 18h32l-4 62H52Z"/>
</g>
${mark(101, 70, 8)}`,

  jigger: `${shadow(80, 30)}
<path class="m" d="M54 18h52L86 58H74Z"/>
<path class="d" d="M74 60h12l20 44H54Z"/>
<rect class="p" x="71" y="55" width="18" height="7" rx="2"/>
<path class="op" d="M66 30h28M70 40h20"/>`,

  kit: `${shadow(80, 58)}
<path class="p" d="M44 30h16l-2 24H46Z"/><path class="o" d="M44 30h16l-2 24H46Z"/>
<path class="p" d="M62 26h16l-2 28H64Z"/><path class="o" d="M62 26h16l-2 28H64Z"/>
<rect class="s" x="84" y="22" width="30" height="34" rx="3" transform="rotate(8 99 39)"/>
<path class="d" d="M28 54l14-12h76l14 12Z"/>
<path class="m" d="M28 54h104v46c0 3-2 5-5 5H33c-3 0-5-2-5-5Z"/>
${mark(80, 80, 13)}`,

  cups: `${shadow(80, 56)}
<path class="p" d="M30 58h24l-3 42H33Z"/><path class="o" d="M30 58h24l-3 42H33Z"/>
<path class="p" d="M68 50h24l-3 50H71Z"/><path class="m" d="M69.2 70h21.6l-2.4 30H71.6Z"/><path class="o" d="M68 50h24l-3 50H71Z"/>
<path class="p" d="M106 38h24l-3 62h-18Z"/><path class="o" d="M106 38h24l-3 62h-18Z"/>
<path class="ot" d="M106.7 46h22.6M107.4 54h21.2M108 62h20"/>`,

  "table-throw": `${shadow(80, 66)}
<path class="d" d="M28 36h104l10 8H18Z"/>
<path class="m" d="M18 44h124l6 58H12Z"/>
<path class="od" d="M44 46l-4 56M116 46l4 56"/>
${mark(80, 72, 15)}`,

  banner: `${shadow(80, 36)}
<rect class="m" x="56" y="8" width="48" height="90" rx="2"/>
<rect class="i" x="53" y="6" width="54" height="5" rx="2.5"/>
<rect class="i" x="49" y="97" width="62" height="8" rx="3"/>
${mark(80, 36, 13)}
<path class="op" d="M66 62h28M68 70h24M71 78h18"/>`,

  sheets: `${shadow(80, 40)}
<rect class="s" x="50" y="18" width="62" height="82" rx="3" transform="rotate(7 81 59)"/>
<g transform="rotate(-4 80 59)">
<rect class="p" x="48" y="16" width="62" height="84" rx="3"/>
<rect class="m" x="48" y="16" width="62" height="20" rx="3"/>
<path class="ot" d="M58 48h42M58 56h36M58 64h40M58 72h28"/>
<rect class="d" x="58" y="80" width="18" height="12" rx="2"/>
</g>`,

  cards: `${shadow(80, 46)}
<rect class="s" x="56" y="20" width="48" height="70" rx="5" transform="rotate(-16 80 100)"/>
<rect class="d" x="56" y="20" width="48" height="70" rx="5" transform="rotate(16 80 100)"/>
<g>
<rect class="p" x="56" y="18" width="48" height="72" rx="5"/>
<rect class="ot" x="56" y="18" width="48" height="72" rx="5"/>
<path class="m" d="M66 32h28L80 48Z"/>
<path class="o" d="M80 48v12M73 62h14"/>
<path class="ot" d="M66 72h28M70 79h20"/>
</g>`,

  sticker: `${shadow(80, 40)}
<circle class="m" cx="80" cy="56" r="40"/>
<circle class="op" cx="80" cy="56" r="33"/>
${mark(80, 56, 21)}
<path class="p" d="M104 88c8-2 13-8 15-16 3 10-4 20-15 16Z"/>
<path class="ot" d="M104 88c8-2 13-8 15-16 3 10-4 20-15 16Z"/>`,

  bottle: `${shadow(80, 28)}
<path class="m" d="M71 16h18v20c0 6 13 10 13 26v42c0 3-2 5-5 5H63c-3 0-5-2-5-5V62c0-16 13-20 13-26Z"/>
<rect class="d" x="70" y="10" width="20" height="12" rx="3"/>
<rect class="p" x="62" y="62" width="36" height="30" rx="3"/>
${mark(80, 77, 10)}`,
};

/**
 * @param {{art?: string, tone?: string, image?: string, name?: string}} item
 * @param {string} [extraClass]
 */
export function artwork(item, extraClass = "") {
  const box = document.createElement("div");
  box.className = `art tone-${item.tone || "palm"}${extraClass ? ` ${extraClass}` : ""}`;

  if (item.image) {
    const img = document.createElement("img");
    img.src = item.image;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.remove();
      box.innerHTML = svgFor(item.art);
    });
    box.append(img);
  } else {
    box.innerHTML = svgFor(item.art);
  }
  return box;
}

function svgFor(kind) {
  const body = ART[kind] || ART.bottle;
  return `<svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export const ART_LABELS = {
  tee: "T-shirt", polo: "Polo", cap: "Cap", apron: "Apron", rocks: "Rocks glass",
  shot: "Shot glasses", glencairn: "Tasting glass", tumbler: "Tumbler",
  "shelf-talker": "Shelf talker", "neck-hanger": "Neck hanger", "table-tent": "Table tent",
  "bar-mat": "Bar mat", neon: "LED sign", "tin-sign": "Tin sign", shaker: "Shaker tins",
  jigger: "Jigger", kit: "Event kit", cups: "Sample cups", "table-throw": "Table throw",
  banner: "Pull-up banner", sheets: "Sell sheets", cards: "Recipe cards", sticker: "Sticker",
  bottle: "Bottle",
};
