import { injectHtmlRenderHead } from "./htmlRender.ts";
import { HTML_RENDER_SECTION_SCRIPT } from "./htmlRenderSectionScript.ts";
import { HTML_RENDER_SELECTION_SCRIPT } from "./htmlRenderSelectionScript.ts";

// A separate module so clients that only lay out renders, like mobile, don't bundle the scripts.
/** Adds selection support to saved renders without changing their stored contents. */
export function injectHtmlSelectionBridge(html: string): string {
  return injectHtmlRenderHead(
    html,
    `<style>::highlight(t3-html-citation){background:color-mix(in srgb,var(--accent) 45%,transparent)}</style><script>${HTML_RENDER_SELECTION_SCRIPT}\n${HTML_RENDER_SECTION_SCRIPT}</script>`,
  );
}
