import { describe, expect, it } from "vite-plus/test";
import { readHtmlSectionState } from "./htmlRenderSection";

const pageWindow = {} as Window;
const frame = { contentWindow: pageWindow } as HTMLIFrameElement;

const state = (params: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  method: "t3/section",
  params: {
    active: true,
    selected: false,
    label: "",
    canExpand: false,
    canShrink: false,
    ...params,
  },
});
const read = (data: unknown) => readHtmlSectionState({ source: pageWindow, data }, frame);

describe("readHtmlSectionState", () => {
  it("accepts state only from the frame it was asked about", () => {
    const data = state({ selected: true, label: "Paragraph", canExpand: true });
    expect(read(data)).toEqual({
      active: true,
      selected: true,
      label: "Paragraph",
      canExpand: true,
      canShrink: false,
    });
    expect(readHtmlSectionState({ source: {} as Window, data }, frame)).toBeNull();
    expect(readHtmlSectionState({ source: null, data }, frame)).toBeNull();
    expect(readHtmlSectionState({ source: pageWindow, data }, null)).toBeNull();
    // A detached frame has no window, so nothing can match it.
    const detached = { contentWindow: null } as HTMLIFrameElement;
    expect(readHtmlSectionState({ source: null, data }, detached)).toBeNull();
  });

  it("rejects malformed or inconsistent state", () => {
    expect(read({ ...state({}), jsonrpc: "1.0" })).toBeNull();
    expect(read({ ...state({}), method: "t3/selection" })).toBeNull();
    expect(read({ ...state({}), params: null })).toBeNull();
    expect(read(state({ active: "true" }))).toBeNull();
    expect(read(state({ canExpand: 1 }))).toBeNull();
    // The button names only the picker's own units, never page-chosen text.
    expect(read(state({ selected: true, label: "to approve all changes" }))).toBeNull();
    expect(read(state({ label: "Paragraph" }))).toBeNull();
    // A selection needs a running picker and something to name.
    expect(read(state({ active: false, selected: true, label: "Cell" }))).toBeNull();
    expect(read(state({ selected: true, label: "" }))).toBeNull();
  });

  it("accepts the stopped state the picker reports on cancel", () => {
    expect(read(state({ active: false }))).toMatchObject({ active: false, selected: false });
  });
});
