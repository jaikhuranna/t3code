import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { ArrowDownIcon, ArrowUpIcon, QuoteIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  isSelectionRectVisible,
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";
import {
  htmlSectionCommand,
  readHtmlSectionState,
  type HtmlSectionState,
} from "~/lib/htmlRenderSection";
import {
  htmlSelectionClientRect,
  htmlSelectionCommand,
  htmlSelectionParams,
  readHtmlSelection,
  readHtmlSelectionRect,
} from "~/lib/htmlRenderSelection";

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
}) {
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
    tooLong?: boolean;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState<{
    frame: HTMLIFrameElement;
    state: HtmlSectionState;
  } | null>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => setSelection(null);
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (!isSelectionRectVisible(rect, [viewportRect])) {
        clear();
        return;
      }
      // A selection can cross blocks with different clipping ancestors.
      const common = captured.range.commonAncestorContainer;
      const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
      let node = common.nodeType === Node.TEXT_NODE ? common : walker.nextNode();
      let visible = false;
      for (; node && !visible; node = walker.nextNode()) {
        if (!captured.range.intersectsNode(node)) continue;
        if (node.parentElement && getComputedStyle(node.parentElement).userSelect === "none")
          continue;
        const fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (node === captured.range.startContainer) {
          fragment.setStart(node, captured.range.startOffset);
        }
        if (node === captured.range.endContainer) {
          fragment.setEnd(node, captured.range.endOffset);
        }
        if (!fragment.toString().trim()) continue;
        const lines = Array.from(fragment.getClientRects());
        if (!lines.some((line) => isSelectionRectVisible(line, [viewportRect]))) continue;
        const clips: Pick<DOMRect, "left" | "right" | "top" | "bottom">[] = [viewportRect];
        for (
          let element = node.parentElement;
          element && element !== viewport;
          element = element.parentElement
        ) {
          const style = getComputedStyle(element);
          const clipX = style.overflowX !== "visible";
          const clipY = style.overflowY !== "visible";
          if (!clipX && !clipY) continue;
          const bounds = element.getBoundingClientRect();
          const left = bounds.left + element.clientLeft;
          const top = bounds.top + element.clientTop;
          clips.push({
            left: clipX ? left : -Infinity,
            right: clipX ? left + element.clientWidth : Infinity,
            top: clipY ? top : -Infinity,
            bottom: clipY ? top + element.clientHeight : Infinity,
          });
        }
        visible = lines.some((line) => isSelectionRectVisible(line, clips));
      }
      if (!visible) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      const pointerOnText =
        pointer !== null &&
        Array.from(rects).some(
          (line) =>
            pointer.x >= line.left - 8 &&
            pointer.x <= line.right + 8 &&
            pointer.y >= line.top - 8 &&
            pointer.y <= line.bottom + 8,
        );
      setSelection({
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer: pointerOnText ? pointer : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      restoreAfterScroll: true,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = toolbar.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (!firstAction) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    const htmlSelection = (event: MessageEvent) => {
      const params = htmlSelectionParams(event.data);
      if (params === undefined) return;
      const frame = [
        ...viewport.querySelectorAll<HTMLIFrameElement>("iframe[data-html-selection-bridge]"),
      ].find((frame) => frame.contentWindow === event.source);
      const source = frame?.closest<HTMLElement>("[data-assistant-citation-source]");
      const messageId = source?.dataset.assistantCitationSource;
      if (!frame || !source || !messageId) return;
      if (params === null) {
        setSelection((previous) =>
          document.activeElement === frame || previous?.sourceAnchor.htmlRender === frame
            ? null
            : previous,
        );
        return;
      }
      if (params.focus === true) {
        if (document.activeElement === frame)
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus({ preventScroll: true });
        return;
      }
      if ("target" in params) return;
      if (document.activeElement !== frame) return;
      const captured = readHtmlSelection(event.data);
      const localRect =
        captured?.rect ?? (params.tooLong === true ? readHtmlSelectionRect(params.rect) : null);
      if (!localRect) {
        clear();
        return;
      }
      const rect = htmlSelectionClientRect(frame, localRect);
      const bounds = viewport.getBoundingClientRect();
      const frameBounds = frame.getBoundingClientRect();
      if (
        rect.bottom < bounds.top ||
        rect.top > bounds.bottom ||
        rect.bottom < frameBounds.top ||
        rect.top > frameBounds.bottom
      ) {
        clear();
        return;
      }
      const selector = captured?.selector ?? { text: "", start: 0, end: 1, prefix: "", suffix: "" };
      let currentRect = localRect;
      const sourceRect = () => htmlSelectionClientRect(frame, currentRect);
      setSelection({
        tooLong: params.tooLong === true,
        citation: { version: 1, ...threadRef, messageId: MessageId.make(messageId), ...selector },
        sourceAnchor: {
          source,
          viewport,
          htmlRender: frame,
          updateRange: (next) => {
            const changed = (["left", "top", "width", "height"] as const).some(
              (key) => next[key] !== currentRect[key],
            );
            currentRect = next;
            return changed;
          },
          range: {
            getBoundingClientRect: sourceRect,
            getClientRects: () =>
              Object.assign([sourceRect()], {
                item: (index: number) => (index === 0 ? sourceRect() : null),
              }),
          },
        },
        position: resolveSelectionActionPosition({
          bounds,
          selectionRect: rect,
          pointer: captured?.pointer
            ? { x: frameBounds.left + captured.pointer.x, y: frameBounds.top + captured.pointer.y }
            : null,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const sectionState = (event: MessageEvent) => {
      if (event.data?.method !== "t3/section") return;
      const frame = [
        ...viewport.querySelectorAll<HTMLIFrameElement>("iframe[data-html-selection-bridge]"),
      ].find((candidate) => candidate.contentWindow === event.source);
      if (!frame) return;
      const state = readHtmlSectionState(event, frame);
      if (!state) return;
      setSection((previous) =>
        state.active ? { frame, state } : previous?.frame === frame ? null : previous,
      );
    };
    window.addEventListener("message", htmlSelection);
    window.addEventListener("message", sectionState);
    return () => {
      window.removeEventListener("message", htmlSelection);
      window.removeEventListener("message", sectionState);
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  if (!selection) return null;
  const tooLong =
    selection.tooLong || selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    if (section && section.frame === selection.sourceAnchor.htmlRender) {
      htmlSectionCommand(section.frame, "stop");
      setSection(null);
    }
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    if (selection.sourceAnchor.htmlRender) {
      htmlSelectionCommand(selection.sourceAnchor.htmlRender, "clear");
    } else window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const selectedSection =
    section?.frame === selection.sourceAnchor.htmlRender && section?.state.selected
      ? section
      : null;
  return createPortal(
    <div
      ref={toolbarRef}
      // Marks the toolbar as part of the picking render, so pressing it doesn't cancel picking.
      data-html-section-toolbar={
        section?.frame === selection.sourceAnchor.htmlRender ? "true" : undefined
      }
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1"
      style={{ left: selection.position.x, top: selection.position.y }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (selection.sourceAnchor.htmlRender)
            htmlSelectionCommand(selection.sourceAnchor.htmlRender, "dismiss");
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        onPointerDown={(event) => event.preventDefault()}
        onClick={cite}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {tooLong
          ? "Shorten selection"
          : selectedSection
            ? `Cite ${selectedSection.state.label.toLowerCase()}`
            : "Cite"}
      </Button>
      {selectedSection && (
        <>
          <Button
            size="icon-xs"
            variant="glass"
            aria-label="Select smaller section"
            title="Select smaller section"
            disabled={!selectedSection.state.canShrink}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => htmlSectionCommand(selectedSection.frame, "shrink")}
          >
            <ArrowDownIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="glass"
            aria-label="Select larger section"
            title="Select larger section"
            disabled={!selectedSection.state.canExpand}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => htmlSectionCommand(selectedSection.frame, "expand")}
          >
            <ArrowUpIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="glass"
            aria-label="Cancel section selection"
            onClick={dismiss}
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </>
      )}
    </div>,
    document.body,
  );
}
