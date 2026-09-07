import { useEffect, useRef, useState } from "react";

// Shared drag-to-resize logic for the sidebar and side-panel width handles.
// `invert` flips the drag direction: the sidebar's handle is on its right edge
// (drag right = wider), the side panel's is on its left edge (drag right =
// narrower).
export function useDragResize({ initial, min, max, invert = false }) {
  const [width, setWidth] = useState(initial);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onMouseDown = (e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = width;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = invert
        ? dragStartX.current - e.clientX
        : e.clientX - dragStartX.current;
      setWidth(Math.max(min, Math.min(max, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [invert, min, max]);

  return { width, onMouseDown };
}
