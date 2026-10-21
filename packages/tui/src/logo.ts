// Block-letter wordmark. Each glyph is four rows: an ascender row and three body rows.
// `_` is a shaded space, `^` a shaded upper half block, `~` a shadow-coloured upper half block.
const glyph = {
  k: ["▄   ", "█_▄▀", "█▀▄_", "▀  ▀"],
  t: [" ▄  ", "▀█▀▀", " █  ", " ▀▀▀"],
  e: ["    ", "█▀▀█", "█^^^", "▀▀▀▀"],
  h: ["▄   ", "█▀▀▄", "█__█", "▀~~▀"],
  r: ["    ", "█▀▀▀", "█___", "▀   "],
}

const word = (letters: string) =>
  [0, 1, 2, 3].map((row) =>
    Array.from(letters)
      .map((letter) => glyph[letter as keyof typeof glyph][row])
      .join(" "),
  )

// `kt` is drawn muted and `ether` bold, side by side or stacked on narrow terminals.
export const logo = {
  left: word("kt"),
  right: word("ether"),
}

// The monogram for terminals too narrow for the wordmark.
export const go = {
  left: word("k"),
  right: word("kt"),
}
