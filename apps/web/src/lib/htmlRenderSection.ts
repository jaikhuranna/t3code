// Parent side of the section picker that runs inside a saved HTML render. The
// picker only selects native text; the selection bridge does the citing.
import { HTML_RENDER_SECTION_LABELS } from "@t3tools/shared/htmlRenderSectionLabels";

export type HtmlSectionState = {
  active: boolean;
  selected: boolean;
  label: string;
  canExpand: boolean;
  canShrink: boolean;
};

export type HtmlSectionAction = "start" | "stop" | "expand" | "shrink" | "status";

/** Reads a `t3/section` state message, accepting it only from the given frame. */
export function readHtmlSectionState(
  event: Pick<MessageEvent, "source" | "data">,
  frame: HTMLIFrameElement | null | undefined,
): HtmlSectionState | null {
  if (!frame?.contentWindow || event.source !== frame.contentWindow) return null;
  const data = event.data as Record<string, unknown> | null;
  if (typeof data !== "object" || data === null) return null;
  if (data.jsonrpc !== "2.0" || data.method !== "t3/section") return null;
  const p = data.params as Record<string, unknown> | null;
  if (typeof p !== "object" || p === null) return null;
  const { active, selected, label, canExpand, canShrink } = p;
  if (
    typeof active !== "boolean" ||
    typeof selected !== "boolean" ||
    typeof label !== "string" ||
    typeof canExpand !== "boolean" ||
    typeof canShrink !== "boolean" ||
    // The page is untrusted, so the Cite button only ever names one of the picker's units.
    (selected ? !active || !HTML_RENDER_SECTION_LABELS.has(label) : label !== "")
  )
    return null;
  return { active, selected, label, canExpand, canShrink };
}

/** Sends a picker command; focusing first keeps the frame's Escape and arrow keys working. */
export function htmlSectionCommand(frame: HTMLIFrameElement, action: HtmlSectionAction) {
  if (action !== "stop" && action !== "status") frame.focus({ preventScroll: true });
  frame.contentWindow?.postMessage({ method: "t3/section-command", params: { action } }, "*");
}

/**
 * Stops a running picker when the user moves on: pressing or focusing anything
 * outside the render and its Cite toolbar, Escape, or, once a section is chosen,
 * scrolling the thread, which also dismisses that section's Cite toolbar.
 */
export function observeHtmlSectionPickerExit({
  box,
  frame,
  selected,
}: {
  box: HTMLElement;
  frame: HTMLIFrameElement;
  selected: boolean;
}): () => void {
  const stop = () => htmlSectionCommand(frame, "stop");
  const outside = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      (box.contains(target) || target.closest("[data-html-section-toolbar]"))
    )
      return;
    stop();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") stop();
  };
  const thread = selected ? box.closest("[data-assistant-citation-viewport]") : null;
  document.addEventListener("pointerdown", outside, true);
  // Focus moving into another frame never reaches this document as a pointer event.
  document.addEventListener("focusin", outside);
  document.addEventListener("keydown", escape);
  thread?.addEventListener("scroll", stop, true);
  return () => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("focusin", outside);
    document.removeEventListener("keydown", escape);
    thread?.removeEventListener("scroll", stop, true);
  };
}
