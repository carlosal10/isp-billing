import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VIEWPORT_MARGIN = 16;
const MOBILE_BREAKPOINT = 768;

function coerceNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function centerBox({ width, height }) {
  const vw = typeof window !== "undefined" ? window.innerWidth : width;
  const vh = typeof window !== "undefined" ? window.innerHeight : height;
  const maxWidth = Math.max(VIEWPORT_MARGIN * 2, vw - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(VIEWPORT_MARGIN * 2, vh - VIEWPORT_MARGIN * 2);
  const w = Math.min(width, maxWidth);
  const h = Math.min(height, maxHeight);
  const left = Math.max(VIEWPORT_MARGIN, Math.round((vw - w) / 2));
  const top = Math.max(VIEWPORT_MARGIN, Math.round((vh - h) / 2));
  return { width: w, height: h, top, left };
}

function clampBox(box, { minWidth, minHeight }) {
  const vw = typeof window !== "undefined" ? window.innerWidth : box.width;
  const vh = typeof window !== "undefined" ? window.innerHeight : box.height;
  const maxWidth = Math.max(minWidth, vw - VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(minHeight, vh - VIEWPORT_MARGIN * 2);

  let width = Math.min(Math.max(box.width, minWidth), maxWidth);
  let height = Math.min(Math.max(box.height, minHeight), maxHeight);

  let left = Math.min(Math.max(box.left, VIEWPORT_MARGIN), vw - width - VIEWPORT_MARGIN);
  let top = Math.min(Math.max(box.top, VIEWPORT_MARGIN), vh - height - VIEWPORT_MARGIN);

  if (!Number.isFinite(left)) left = VIEWPORT_MARGIN;
  if (!Number.isFinite(top)) top = VIEWPORT_MARGIN;

  return { width, height, top, left };
}

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

export function useDragResize({
  isOpen,
  containerRef,
  handleRef,
  minWidth = 480,
  minHeight = 360,
  defaultSize,
} = {}) {
  const [box, setBox] = useState(() =>
    centerBox({
      width: defaultSize?.width || 720,
      height: defaultSize?.height || 480,
    })
  );
  const [isTouchLayout, setIsTouchLayout] = useState(() => isMobileViewport());
  const dragStateRef = useRef(null);

  const ensureBoxWithinViewport = useCallback(() => {
    setBox((prev) => clampBox(prev, { minWidth, minHeight }));
  }, [minWidth, minHeight]);

  useEffect(() => {
    if (!isOpen || isTouchLayout) return;
    const next = centerBox({
      width: defaultSize?.width || box.width,
      height: defaultSize?.height || box.height,
    });
    setBox(clampBox(next, { minWidth, minHeight }));
  }, [isOpen, isTouchLayout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      const mobile = isMobileViewport();
      setIsTouchLayout(mobile);
      if (!mobile) {
        ensureBoxWithinViewport();
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [ensureBoxWithinViewport]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    if (isTouchLayout) {
      el.style.position = "";
      el.style.width = "";
      el.style.height = "";
      el.style.left = "";
      el.style.top = "";
      return;
    }
    el.style.position = "absolute";
    el.style.width = `${Math.round(box.width)}px`;
    el.style.height = `${Math.round(box.height)}px`;
    el.style.left = `${Math.round(box.left)}px`;
    el.style.top = `${Math.round(box.top)}px`;
  }, [box, containerRef, isTouchLayout]);

  useEffect(() => {
    const el = handleRef?.current || containerRef?.current;
    if (!isOpen || !el || isTouchLayout) return undefined;

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".modal-resize-handle")) return;
      if (event.target.closest("[data-modal-no-drag]")) return;
      event.preventDefault();

      const rect = { ...box };
      dragStateRef.current = {
        mode: "drag",
        startX: event.clientX,
        startY: event.clientY,
        startBox: rect,
      };

      document.body.style.userSelect = "none";

      const onMove = (ev) => {
        if (!dragStateRef.current || dragStateRef.current.mode !== "drag") return;
        const dx = ev.clientX - dragStateRef.current.startX;
        const dy = ev.clientY - dragStateRef.current.startY;
        const next = {
          ...dragStateRef.current.startBox,
          left: dragStateRef.current.startBox.left + dx,
          top: dragStateRef.current.startBox.top + dy,
        };
        setBox(clampBox(next, { minWidth, minHeight }));
      };

      const onUp = () => {
        dragStateRef.current = null;
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    el.addEventListener("pointerdown", onPointerDown);
    return () => el.removeEventListener("pointerdown", onPointerDown);
  }, [box, containerRef, handleRef, isOpen, isTouchLayout, minHeight, minWidth]);

  const startResize = useCallback(
    (event, direction) => {
      if (isTouchLayout) return;
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = { ...box };
      dragStateRef.current = {
        mode: "resize",
        direction,
        startX: event.clientX,
        startY: event.clientY,
        startBox: rect,
      };
      document.body.style.userSelect = "none";

      const onMove = (ev) => {
        if (!dragStateRef.current || dragStateRef.current.mode !== "resize") return;
        const { direction: dir, startX, startY, startBox } = dragStateRef.current;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let next = { ...startBox };

        if (dir.includes("e")) {
          next.width = coerceNumber(startBox.width + dx, startBox.width);
        }
        if (dir.includes("s")) {
          next.height = coerceNumber(startBox.height + dy, startBox.height);
        }
        if (dir.includes("w")) {
          const newWidth = coerceNumber(startBox.width - dx, startBox.width);
          const delta = next.width - newWidth;
          next.left += dx;
          next.width = newWidth;
          if (delta !== 0 && next.width < minWidth) {
            next.left = startBox.left + (startBox.width - minWidth);
            next.width = minWidth;
          }
        }
        if (dir.includes("n")) {
          const newHeight = coerceNumber(startBox.height - dy, startBox.height);
          const delta = next.height - newHeight;
          next.top += dy;
          next.height = newHeight;
          if (delta !== 0 && next.height < minHeight) {
            next.top = startBox.top + (startBox.height - minHeight);
            next.height = minHeight;
          }
        }

        setBox(clampBox(next, { minWidth, minHeight }));
      };

      const onUp = () => {
        dragStateRef.current = null;
        document.body.style.userSelect = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [box, isTouchLayout, minHeight, minWidth]
  );

  const getResizeHandleProps = useCallback(
    (direction) =>
      isTouchLayout
        ? {}
        : {
            onPointerDown: (event) => startResize(event, direction),
          },
    [isTouchLayout, startResize]
  );

  const reset = useCallback(() => {
    if (isTouchLayout) return;
    setBox((prev) =>
      clampBox(
        centerBox({
          width: defaultSize?.width || prev.width,
          height: defaultSize?.height || prev.height,
        }),
        { minWidth, minHeight }
      )
    );
  }, [defaultSize, isTouchLayout, minHeight, minWidth]);

  return useMemo(
    () => ({
      getResizeHandleProps,
      reset,
      isDraggingEnabled: !isTouchLayout,
    }),
    [getResizeHandleProps, isTouchLayout, reset]
  );
}

export default useDragResize;
