import { HTML_RENDER_SECTION_TAG_LABELS } from "./htmlRenderSectionLabels.ts";

// Runs beside the text selection bridge inside sandboxed saved renders.
export const HTML_RENDER_SECTION_SCRIPT = String.raw`(() => {
  // Matches what the selection bridge leaves out of a quote, so a chosen section always has text.
  const excluded = 'button,input,textarea,select,option,[role=button],[contenteditable],[hidden],[aria-hidden=true],script,style,template,noscript,svg';
  const labels = ${JSON.stringify(HTML_RENDER_SECTION_TAG_LABELS)};
  let active = false;
  let selected = false;
  let chain = [];
  let index = 0;
  let overlay = null;
  let pending = 0;
  let refreshSelection = false;
  let pointerTarget = null;
  let hoverTarget = null;
  let hover = null;
  let lastState = null;
  const post = (force = false) => {
    const params = { active, selected, label: selected ? label(chain[index]) : '', canExpand: selected && index < chain.length - 1, canShrink: selected && index > 0 };
    const state = JSON.stringify(params);
    if (!force && state === lastState) return;
    lastState = state;
    window.parent.postMessage({ jsonrpc: '2.0', method: 't3/section', params }, '*');
  };
  const invisible = (style) => style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.userSelect === 'none';
  const text = (element) => {
    if (element.matches(excluded) || element === overlay || invisible(getComputedStyle(element))) return '';
    return Array.from(element.childNodes, (node) => node.nodeType === 3 ? node.textContent : node.nodeType === 1 ? text(node) : '').join(' ').replace(/\s+/g, ' ').trim();
  };
  // Agent pages are often plain divs: one holding its own text is a block, and a
  // decorated one holding several children is a card.
  const ownText = (element) => Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim());
  const card = (element) => {
    if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') || ['region', 'article', 'group'].includes(element.getAttribute('role'))) return true;
    if (element.childElementCount < 2) return false;
    const style = getComputedStyle(element);
    return (parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none') || !['transparent', 'rgba(0, 0, 0, 0)', ''].includes(style.backgroundColor);
  };
  const label = (element) => labels[element.tagName] || (ownText(element) ? 'Text' : 'Card');
  const unit = (element) => !!labels[element.tagName] || (element.tagName === 'DIV' && (ownText(element) || card(element)));
  // Stops at the first quotable text node, so hovering stays cheap inside large blocks.
  const hasText = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      let parent = node.parentElement;
      while (parent && parent !== element && !parent.matches(excluded) && !invisible(getComputedStyle(parent))) parent = parent.parentElement;
      if (parent === element) return true;
    }
    return false;
  };
  // The nearest unit with text to quote, so what is outlined is what a click selects.
  // Pointing at an icon, chart or control starts from what contains it.
  const candidate = (target) => {
    if (!(target instanceof Element) || target === overlay) return null;
    let start = target;
    for (let node = target; node; node = node.parentElement) {
      if (node.matches(excluded) || invisible(getComputedStyle(node))) start = node.parentElement;
    }
    for (let node = start; node && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement) {
      if (unit(node) && hasText(node)) return node;
    }
    return null;
  };
  // Built only on click: each step outward must add text, so wrappers are skipped.
  const hierarchy = (element) => {
    const result = [];
    let previous = '';
    for (let node = element; node && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement) {
      if (!unit(node)) continue;
      const content = text(node);
      if (!content || content === previous) continue;
      result.push(node);
      previous = content;
    }
    return result;
  };
  const draw = () => {
    pending = 0;
    const refresh = refreshSelection;
    refreshSelection = false;
    if (!active) return;
    if (!selected && pointerTarget !== hoverTarget) {
      hoverTarget = pointerTarget;
      hover = candidate(pointerTarget);
    }
    const element = selected ? chain[index] : hover;
    if (!element || !element.isConnected) {
      if (overlay) overlay.style.display = 'none';
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('data-t3-section-overlay', '');
      overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid #3b82f6;outline-offset:2px;border-radius:3px;box-sizing:border-box;';
      document.documentElement.append(overlay);
    }
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    if (refresh && selected) document.dispatchEvent(new Event('t3-section-selection'));
  };
  const schedule = () => { if (!pending) pending = requestAnimationFrame(draw); };
  const viewportChanged = () => {
    refreshSelection = selected;
    schedule();
  };
  const select = () => {
    const element = chain[index];
    const selection = window.getSelection();
    selection.removeAllRanges();
    if (element) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.addRange(range);
    }
    selected = !!element;
    document.dispatchEvent(new Event('selectionchange'));
    if (selected) document.dispatchEvent(new Event('t3-section-selection'));
    post();
    schedule();
  };
  const move = (event) => {
    if (selected) return;
    pointerTarget = event.target;
    schedule();
  };
  const click = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = candidate(event.target);
    chain = target ? hierarchy(target) : [];
    index = 0;
    select();
  };
  const down = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const resize = (direction) => {
    if (!selected) return;
    const next = Math.max(0, Math.min(chain.length - 1, index + direction));
    if (next !== index) { index = next; select(); }
  };
  const key = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); stop(); }
    else if (selected && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      resize(event.key === 'ArrowUp' ? 1 : -1);
    }
  };
  const listeners = (add) => {
    const method = add ? 'addEventListener' : 'removeEventListener';
    document[method]('pointermove', move, true);
    document[method]('pointerdown', down, true);
    document[method]('click', click, true);
    document[method]('keydown', key, true);
    document[method]('scroll', viewportChanged, true);
    window[method]('resize', viewportChanged);
  };
  const stop = () => {
    active = false;
    selected = false;
    chain = [];
    index = 0;
    pointerTarget = null;
    hoverTarget = null;
    hover = null;
    listeners(false);
    if (pending) cancelAnimationFrame(pending);
    pending = 0;
    refreshSelection = false;
    if (overlay) overlay.remove();
    overlay = null;
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    post();
  };
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data?.method === 't3/selection-command' && event.data.params?.action === 'clear') {
      if (active) stop();
      return;
    }
    if (event.data?.method !== 't3/section-command') return;
    const action = event.data.params?.action;
    if (action === 'status') {
      post(true);
    } else if (action === 'start') {
      if (active) return;
      active = true;
      listeners(true);
      post();
    } else if (action === 'stop') stop();
    else if (active && action === 'expand') resize(1);
    else if (active && action === 'shrink') resize(-1);
  });
})();`;
