import { api } from "./api";

const INTERACTIVE = "button, input, select, textarea, a, [contenteditable='true']";
const TITLEBAR_AREA = ".topbar, .sidebar";
const SIDEBAR_IGNORE = ".sidebar-section, .sidebar-footer";
const BOUND_FLAG = "__redisStudioTitlebarDblclickBound";

function onTitleBarDoubleClick(event: Event) {
  const detail = (event as CustomEvent<{ target?: EventTarget | null }>).detail;
  const target = detail?.target;
  if (!(target instanceof Element)) return;
  if (!target.closest(TITLEBAR_AREA)) return;
  if (target.closest(INTERACTIVE)) return;
  if (target.closest(SIDEBAR_IGNORE)) return;
  void api.handleTitleBarDoubleClick().catch(() => {});
}

if (typeof window !== "undefined" && !(window as unknown as Record<string, unknown>)[BOUND_FLAG]) {
  (window as unknown as Record<string, unknown>)[BOUND_FLAG] = true;
  window.addEventListener("wails-titlebar-dblclick", onTitleBarDoubleClick);
}
