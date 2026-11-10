import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { Maximize2Icon, SquareDashedMousePointerIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HtmlRenderDialog } from "./HtmlRenderDialog";
import {
  htmlSectionCommand,
  observeHtmlSectionPickerExit,
  readHtmlSectionState,
  type HtmlSectionState,
} from "~/lib/htmlRenderSection";
import { observeResize } from "~/lib/observeResize";

const MIN_URL_LIFE_MS = 5 * 60_000;
const SECTION_FRAME = "iframe[data-html-selection-bridge]";

export function HtmlRenderFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly onFullscreenChange?: (fullscreen: boolean) => void;
}) {
  const { attachmentId, title } = props.htmlRender;
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
  }, []);
  // Client fonts can wrap a page taller than the server measured it; a frame
  // left short would scroll inside the thread and take the reader's scroll.
  const [contentHeight, setContentHeight] = useState<number>();
  const height = htmlRenderFrameHeight(props.htmlRender, width, contentHeight);
  const fileName = htmlRenderFileName(title);
  const resource = {
    _tag: "attachment" as const,
    attachmentId,
    fileName,
    mimeType: "text/html",
    disposition: "inline" as const,
  };
  // A cached URL with life left is reused, so the browser's cache serves the
  // page again; one near expiry is minted afresh, since a frame cannot report a
  // failed load.
  const [src, setSrc] = useState<string | null>(null);
  const srcExpiresAt = useRef(0);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const { onFullscreenChange } = props;
  useEffect(() => {
    if (expandedSrc === null) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [expandedSrc, onFullscreenChange]);
  const [failed, setFailed] = useState(false);
  const assetUrl = useAssetUrlState(src === null ? props.environmentId : null, resource);
  const cachedUrl = assetUrl._tag === "Success" ? assetUrl.url : null;
  const cachedExpiresAt = assetUrl._tag === "Success" ? assetUrl.expiresAt : 0;
  const cacheFailed = assetUrl._tag === "Failure";
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  // At most one mint per mount: expiry is server time and the check uses the
  // client clock, so a skewed clock must not mint again on every update.
  const minting = useRef(false);
  useEffect(() => {
    if (src !== null || minting.current) return;
    if (cacheFailed) {
      // oxlint-disable-next-line react/set-state-in-effect -- Mirrors the cached URL's failure.
      setFailed(true);
      return;
    }
    if (cachedUrl === null) return;
    if (cachedExpiresAt - Date.now() > MIN_URL_LIFE_MS) {
      srcExpiresAt.current = cachedExpiresAt;
      setSrc(cachedUrl);
      return;
    }
    minting.current = true;
    void refresh().then(
      (url) => (url === null ? setFailed(true) : setSrc(url)),
      () => setFailed(true),
    );
  }, [cacheFailed, cachedExpiresAt, cachedUrl, refresh, src]);

  // Mirrors the in-frame section picker. A reload starts a fresh page, so the
  // picker is off until the frame reports otherwise.
  const [sectionState, setSectionState] = useState<HtmlSectionState | null>(null);
  const sectionActive = sectionState?.active ?? false;
  const sectionFrame = () =>
    boxRef.current?.querySelector<HTMLIFrameElement>(SECTION_FRAME) ?? null;
  useEffect(() => {
    if (src === null) return;
    const box = boxRef.current;
    const frame = box?.querySelector<HTMLIFrameElement>(SECTION_FRAME);
    if (!box || !frame) return;
    let active = false;
    const onMessage = (event: MessageEvent) => {
      const state = readHtmlSectionState(event, frame);
      if (state) {
        active = state.active;
        setSectionState(state);
      }
    };
    const onLoad = () => {
      active = false;
      setSectionState(null);
      htmlSectionCommand(frame, "status");
    };
    window.addEventListener("message", onMessage);
    box.addEventListener("t3-html-selection-ready", onLoad);
    htmlSectionCommand(frame, "status");
    return () => {
      window.removeEventListener("message", onMessage);
      box.removeEventListener("t3-html-selection-ready", onLoad);
      if (active) htmlSectionCommand(frame, "stop");
    };
  }, [src]);

  const sectionSelected = sectionState?.selected ?? false;
  useEffect(() => {
    const box = boxRef.current;
    const frame = box?.querySelector<HTMLIFrameElement>(SECTION_FRAME);
    if (!sectionActive || !box || !frame) return;
    return observeHtmlSectionPickerExit({ box, frame, selected: sectionSelected });
  }, [sectionActive, sectionSelected]);

  return (
    <div
      ref={boxRef}
      className="group/html-render relative"
      style={{ height }}
      data-section-picking={sectionActive || undefined}
    >
      {src !== null ? (
        <>
          <HtmlRenderDocument
            src={src}
            title={title}
            threadRef={props.threadRef}
            className="block size-full"
            onContentHeight={setContentHeight}
            onFullscreenChange={onFullscreenChange}
            selectionBridge
          />
          <div className="absolute end-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/html-render:opacity-100 group-data-section-picking/html-render:opacity-100 pointer-coarse:opacity-100">
            {sectionActive && !sectionState?.selected ? (
              <span className="surface-glass rounded-full border border-border/60 px-2 py-0.5 text-foreground text-xs shadow-sm">
                Choose a section · Esc to cancel
              </span>
            ) : null}
            {sectionState !== null && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="Cite section"
                      aria-pressed={sectionActive}
                      data-pressed={sectionActive || undefined}
                      size="icon-xs"
                      variant="glass"
                      onClick={() => {
                        const frame = sectionFrame();
                        if (frame) htmlSectionCommand(frame, sectionActive ? "stop" : "start");
                      }}
                    />
                  }
                >
                  <SquareDashedMousePointerIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="left">
                  {sectionActive ? "Stop choosing a section" : "Cite a section"}
                </TooltipPopup>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Open full screen"
                    size="icon-xs"
                    variant="glass"
                    onClick={async () => {
                      // Citing stays inline; the full screen page has no picker.
                      const frame = sectionFrame();
                      if (sectionActive && frame) htmlSectionCommand(frame, "stop");
                      const url =
                        srcExpiresAt.current - Date.now() > MIN_URL_LIFE_MS
                          ? src
                          : await refresh().catch(() => null);
                      if (url !== null) setExpandedSrc(url);
                      else
                        toastManager.add({
                          type: "error",
                          title: "Page unavailable",
                          description: "Reconnect to the environment and try again.",
                        });
                    }}
                  />
                }
              >
                <Maximize2Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="left">Open full screen</TooltipPopup>
            </Tooltip>
          </div>
          {expandedSrc !== null ? (
            <HtmlRenderDialog
              src={expandedSrc}
              title={title}
              threadRef={props.threadRef}
              onClose={() => setExpandedSrc(null)}
            />
          ) : null}
        </>
      ) : failed ? (
        <p
          data-html-render-error
          className="flex size-full items-center justify-center text-muted-foreground text-xs"
        >
          Unable to load {title}
        </p>
      ) : null}
    </div>
  );
}
