import { describe, expect, it, vi } from "vite-plus/test";
import { injectHtmlSelectionBridge } from "@t3tools/shared/htmlRenderSelectionBridge";
import { observeHtmlSectionPickerExit } from "./htmlRenderSection";

function page(html: string) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const view = frame.contentWindow as Window & typeof globalThis;
  view.document.open();
  view.document.write(injectHtmlSelectionBridge(`<html><body>${html}</body></html>`));
  view.document.close();
  let callback: FrameRequestCallback | undefined;
  view.requestAnimationFrame = (next) => {
    callback = next;
    return 1;
  };
  view.cancelAnimationFrame = () => {
    callback = undefined;
  };
  const post = vi.spyOn(view.parent, "postMessage");
  const command = (action: string, source: Window = view.parent) =>
    view.dispatchEvent(
      new view.MessageEvent("message", {
        source,
        data: { method: "t3/section-command", params: { action } },
      }),
    );
  const pointer = (type: string, selector: string) => {
    const event = new view.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
    view.document.querySelector(selector)!.dispatchEvent(event);
    return event;
  };
  const flush = () => {
    const next = callback;
    callback = undefined;
    next?.(0);
  };
  const state = () =>
    post.mock.calls.map(([data]) => data).findLast((data) => data.method === "t3/section")?.params;
  const quote = () => {
    const selection = view.getSelection()!;
    return selection.rangeCount ? selection.getRangeAt(0).toString() : "";
  };
  return {
    view,
    command,
    pointer,
    flush,
    state,
    quote,
    pending: () => !!callback,
    stateCount: () => post.mock.calls.filter(([data]) => data.method === "t3/section").length,
    [Symbol.dispose]() {
      post.mockRestore();
      frame.remove();
    },
  };
}

describe("HTML section picker", () => {
  it("selects real paragraph text, freezes, and expands through meaningful unique ancestors", () => {
    using p = page(
      '<section><div><p id="first">First <b>paragraph</b></p></div><p id="second">Second paragraph</p></section>',
    );
    p.command("start");
    expect(p.state()).toMatchObject({ active: true, selected: false, label: "" });
    const posted = p.stateCount();
    p.pointer("pointermove", "b");
    p.flush();
    // Hovering outlines the paragraph without messaging the app.
    const outline = p.view.document.querySelector<HTMLElement>("[data-t3-section-overlay]");
    expect(outline?.style.display).toBe("block");
    expect(p.stateCount()).toBe(posted);
    expect(p.pointer("click", "b").defaultPrevented).toBe(true);
    expect(p.state()).toMatchObject({ label: "Paragraph", canExpand: true });
    expect(p.quote()).toBe("First paragraph");
    p.pointer("pointermove", "#second");
    p.flush();
    expect(p.quote()).toBe("First paragraph");
    p.pointer("click", "#second");
    expect(p.quote()).toBe("Second paragraph");
    p.pointer("click", "#first");
    p.command("expand");
    expect(p.quote()).toBe("First paragraphSecond paragraph");
    expect(p.state()).toMatchObject({ label: "Section", canExpand: false, canShrink: true });
    p.command("shrink");
    expect(p.quote()).toBe("First paragraph");
  });

  it("deduplicates wrappers and selects table cell, row, and table", () => {
    using p = page(
      "<section><table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table></section>",
    );
    p.command("start");
    p.pointer("click", "td");
    expect(p.state().label).toBe("Cell");
    p.command("expand");
    expect(p.state().label).toBe("Row");
    expect(p.quote()).toBe("AB");
    p.command("expand");
    expect(p.state()).toMatchObject({ label: "Table", canExpand: false });
  });

  it("excludes controls and hidden content while permitting captioned graphics", () => {
    using p = page(
      '<button><p>Control</p></button><section hidden><p>Secret</p></section><figure><svg><path/></svg><figcaption>Revenue rose</figcaption></figure><svg id="alone"/>',
    );
    p.command("start");
    p.pointer("click", "button p");
    expect(p.quote()).toBe("");
    p.pointer("click", "section p");
    expect(p.quote()).toBe("");
    p.pointer("click", "path");
    expect(p.state().label).toBe("Figure");
    expect(p.quote()).toBe("Revenue rose");
    p.command("stop");
    p.command("start");
    p.pointer("click", "#alone");
    expect(p.state().selected).toBe(false);
    expect(p.quote()).toBe("");
  });

  it("picks text and cards on pages built from plain divs", () => {
    using p = page(
      '<div style="background:#eee"><div class="title">Error rate</div><div class="value">0.4%</div></div>',
    );
    p.command("start");
    p.pointer("click", ".value");
    expect(p.state()).toMatchObject({ label: "Text", canExpand: true });
    expect(p.quote()).toBe("0.4%");
    p.command("expand");
    expect(p.state()).toMatchObject({ label: "Card", canExpand: false });
    expect(p.quote()).toBe("Error rate0.4%");
  });

  it("outlines exactly what a click selects when the pointed block has nothing to quote", () => {
    using p = page(
      '<section><h2>Revenue <span aria-hidden="true">*</span></h2><figure><svg><text>+20%</text></svg></figure><p style="user-select:none">Locked</p></section>',
    );
    p.command("start");
    const outlined = (selector: string) => {
      p.pointer("pointermove", selector);
      p.flush();
      const outline = p.view.document.querySelector<HTMLElement>("[data-t3-section-overlay]")!;
      return [outline.style.top, outline.style.height].map((value) =>
        Math.round(parseFloat(value)),
      );
    };
    const sectionBox = p.view.document.querySelector("section")!.getBoundingClientRect();
    // A caption-less chart and an unselectable block both lead to their section.
    for (const selector of ["text", "p"]) {
      expect(outlined(selector)).toEqual([sectionBox.top, sectionBox.height].map(Math.round));
      p.pointer("click", selector);
      expect(p.state()).toMatchObject({ selected: true, label: "Section" });
      const range = p.view.getSelection()!.getRangeAt(0);
      expect(range.commonAncestorContainer).toBe(p.view.document.querySelector("section"));
      p.command("stop");
      p.command("start");
    }
    // An icon inside a heading picks the heading.
    p.pointer("click", "h2 span");
    expect(p.state()).toMatchObject({ selected: true, label: "Heading" });
  });

  it("recognizes decorated cards and deduplicates plain wrappers", () => {
    using p = page('<div style="border:1px solid black"><div><p>One</p></div><p>Two</p></div>');
    p.command("start");
    p.pointer("click", "p");
    p.command("expand");
    expect(p.state()).toMatchObject({ label: "Card", canExpand: false });
    expect(p.quote()).toBe("OneTwo");
  });

  it("leaves normal clicks untouched and rejects commands from other windows", () => {
    using p = page("<p>Text</p>");
    expect(p.pointer("click", "p").defaultPrevented).toBe(false);
    p.command("start", p.view);
    expect(p.state()).toBeUndefined();
    expect(p.pointer("click", "p").defaultPrevented).toBe(false);
  });

  it("stops when the ordinary Cite workflow clears its selection", () => {
    using p = page("<p>Quoted section</p>");
    p.command("start");
    p.pointer("click", "p");
    p.view.dispatchEvent(
      new p.view.MessageEvent("message", {
        source: p.view.parent,
        data: { method: "t3/selection-command", params: { action: "clear" } },
      }),
    );
    expect(p.state()).toMatchObject({ active: false, selected: false });
    expect(p.quote()).toBe("");
    expect(p.pointer("click", "p").defaultPrevented).toBe(false);
  });

  it("answers every capability probe before picking and after stopping", () => {
    using p = page("<p>Text</p>");
    p.command("status");
    expect(p.state()).toEqual({
      active: false,
      selected: false,
      label: "",
      canExpand: false,
      canShrink: false,
    });
    const count = p.stateCount();
    p.command("status");
    expect(p.stateCount()).toBe(count + 1);
    p.command("start");
    p.pointer("click", "p");
    p.command("stop");
    const stoppedCount = p.stateCount();
    p.command("status");
    expect(p.stateCount()).toBe(stoppedCount + 1);
    expect(p.state()).toMatchObject({ active: false, selected: false });
  });

  it("refreshes Cite once after coalesced scroll or resize geometry and stays idle afterward", () => {
    using p = page("<p>Quoted section</p>");
    const refreshed = vi.fn();
    p.view.document.addEventListener("t3-section-selection", refreshed);
    p.command("start");
    p.pointer("click", "p");
    expect(refreshed).toHaveBeenCalledTimes(1);
    p.flush();
    expect(refreshed).toHaveBeenCalledTimes(1);
    p.view.document.dispatchEvent(new p.view.Event("scroll"));
    p.view.document.dispatchEvent(new p.view.Event("scroll"));
    p.view.dispatchEvent(new p.view.Event("resize"));
    expect(refreshed).toHaveBeenCalledTimes(1);
    p.flush();
    expect(refreshed).toHaveBeenCalledTimes(2);
    expect(p.pending()).toBe(false);
    p.flush();
    expect(refreshed).toHaveBeenCalledTimes(2);
    p.command("stop");
    p.view.document.dispatchEvent(new p.view.Event("scroll"));
    expect(p.pending()).toBe(false);
    expect(refreshed).toHaveBeenCalledTimes(2);
  });

  it("supports keyboard resizing and Escape clears the selection and scheduled geometry", () => {
    using p = page("<section><p>One</p><p>Two</p></section>");
    p.command("start");
    p.pointer("click", "p");
    const key = (key: string) =>
      p.view.document.dispatchEvent(
        new p.view.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    key("ArrowUp");
    expect(p.state().label).toBe("Section");
    key("ArrowDown");
    expect(p.state().label).toBe("Paragraph");
    // Shift+Arrow keeps extending the native selection.
    const extend = new p.view.KeyboardEvent("keydown", {
      key: "ArrowUp",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    p.view.document.dispatchEvent(extend);
    expect(extend.defaultPrevented).toBe(false);
    expect(p.state().label).toBe("Paragraph");
    p.flush();
    p.view.document.dispatchEvent(new p.view.Event("scroll"));
    expect(p.pending()).toBe(true);
    key("Escape");
    expect(p.quote()).toBe("");
    expect(p.pending()).toBe(false);
    expect(p.state()).toMatchObject({ active: false, selected: false });
    expect(p.view.document.querySelector("[data-t3-section-overlay]")).toBeNull();
    p.view.document.dispatchEvent(new p.view.Event("scroll"));
    expect(p.pending()).toBe(false);
    expect(p.pointer("click", "p").defaultPrevented).toBe(false);
  });
});

describe("leaving the section picker", () => {
  function render(selected: boolean) {
    const thread = document.createElement("div");
    thread.dataset.assistantCitationViewport = "true";
    const box = document.createElement("div");
    const frame = document.createElement("iframe");
    const toolbarButton = document.createElement("button");
    const toolbar = document.createElement("div");
    toolbar.dataset.htmlSectionToolbar = "true";
    toolbar.append(toolbarButton);
    const elsewhere = document.createElement("button");
    const otherFrame = document.createElement("iframe");
    box.append(frame);
    thread.append(box, otherFrame);
    document.body.append(thread, toolbar, elsewhere);
    const post = vi.spyOn(frame.contentWindow!, "postMessage");
    const stops = () =>
      post.mock.calls.filter(
        ([data]) => (data as { params: { action: string } }).params.action === "stop",
      ).length;
    const dispose = observeHtmlSectionPickerExit({ box, frame, selected });
    return {
      thread,
      frame,
      toolbarButton,
      elsewhere,
      otherFrame,
      stops,
      dispose,
      [Symbol.dispose]() {
        dispose();
        post.mockRestore();
        thread.remove();
        toolbar.remove();
        elsewhere.remove();
      },
    };
  }
  const press = (target: Element) =>
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  it("keeps picking through its own render, its Cite toolbar, and thread scrolling", () => {
    using r = render(false);
    press(r.frame);
    press(r.toolbarButton);
    r.toolbarButton.focus();
    r.thread.dispatchEvent(new Event("scroll"));
    expect(r.stops()).toBe(0);
  });

  it("stops when the user presses elsewhere, focuses another render, or presses Escape", () => {
    using r = render(false);
    press(r.elsewhere);
    expect(r.stops()).toBe(1);
    r.otherFrame.focus();
    expect(r.stops()).toBe(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(r.stops()).toBe(3);
    r.dispose();
    press(r.elsewhere);
    expect(r.stops()).toBe(3);
  });

  it("stops a chosen section only when the thread scrolls", () => {
    using r = render(true);
    document.dispatchEvent(new Event("scroll"));
    expect(r.stops()).toBe(0);
    r.thread.dispatchEvent(new Event("scroll"));
    expect(r.stops()).toBe(1);
  });
});
