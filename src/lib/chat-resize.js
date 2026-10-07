export function bindChatResize(root, widthHandle, heightHandle) {
  const minWidth = 280;
  const minHeight = 380;
  function maxWidth() {
    return Math.max(minWidth, window.innerWidth - 36);
  }
  function maxHeight() {
    return Math.max(minHeight, window.innerHeight - 36);
  }
  function clampWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width)) return 380;
    return Math.round(Math.min(maxWidth(), Math.max(minWidth, width)));
  }
  function clampHeight(value) {
    const height = Number(value);
    if (!Number.isFinite(height)) return 560;
    return Math.round(Math.min(maxHeight(), Math.max(minHeight, height)));
  }
  function applyWidth(width) {
    root.style.setProperty("--chat-width", clampWidth(width) + "px");
  }
  function applyHeight(height) {
    root.style.setProperty("--chat-height", clampHeight(height) + "px");
  }
  try {
    const savedWidth = localStorage.getItem("tamsun_chat_width");
    const savedHeight = localStorage.getItem("tamsun_chat_height");
    if (savedWidth) applyWidth(savedWidth);
    if (savedHeight) applyHeight(savedHeight);
  } catch (error) {}

  function track(handle, readStart, onMove, onSave) {
    if (!handle) return;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (error) {}
      const start = readStart(event);
      function move(moveEvent) {
        onMove(start, moveEvent);
      }
      function end() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        onSave();
      }
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  track(
    widthHandle,
    (event) => ({ x: event.clientX, width: root.getBoundingClientRect().width }),
    (start, moveEvent) => applyWidth(start.width + (moveEvent.clientX - start.x)),
    () => {
      try {
        localStorage.setItem("tamsun_chat_width", String(Math.round(root.getBoundingClientRect().width)));
      } catch (error) {}
    }
  );
  track(
    heightHandle,
    (event) => ({ y: event.clientY, height: root.getBoundingClientRect().height }),
    (start, moveEvent) => applyHeight(start.height + (start.y - moveEvent.clientY)),
    () => {
      try {
        localStorage.setItem("tamsun_chat_height", String(Math.round(root.getBoundingClientRect().height)));
      } catch (error) {}
    }
  );
}
