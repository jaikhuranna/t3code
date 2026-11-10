// Kept apart from the picker script so the app can check labels without bundling it.
/** Unit names the in-page section picker gives to semantic elements, by tag. */
export const HTML_RENDER_SECTION_TAG_LABELS: Readonly<Record<string, string>> = {
  P: "Paragraph",
  H1: "Heading",
  H2: "Heading",
  H3: "Heading",
  H4: "Heading",
  H5: "Heading",
  H6: "Heading",
  PRE: "Code",
  BLOCKQUOTE: "Quote",
  LI: "List item",
  TD: "Cell",
  TH: "Cell",
  TR: "Row",
  TABLE: "Table",
  UL: "List",
  OL: "List",
  FIGURE: "Figure",
  ARTICLE: "Section",
  SECTION: "Section",
  FIGCAPTION: "Caption",
};

/** Every unit name the picker can report; the app shows only these on its Cite button. */
export const HTML_RENDER_SECTION_LABELS: ReadonlySet<string> = new Set([
  ...Object.values(HTML_RENDER_SECTION_TAG_LABELS),
  "Text",
  "Card",
]);
