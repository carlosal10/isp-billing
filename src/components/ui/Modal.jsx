import React, { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes } from "react-icons/fa";
import useDragResize from "../../hooks/useDragResize";

export function Modal({ open, onClose, title, children, minWidth = 520, minHeight = 420, defaultSize }) {
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen: open,
    containerRef,
    handleRef: dragHandleRef,
    minWidth,
    minHeight,
    defaultSize: defaultSize || { width: 640, height: 480 },
  });
  const resizeHandles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ui-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={containerRef}
            className="ui-modal-surface draggable-modal"
            role="dialog"
            aria-modal="true"
            aria-label={title || "Dialog"}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
          >
            {isDraggingEnabled && (
              <>
                <div className="modal-drag-bar" ref={dragHandleRef}>Drag</div>
                {resizeHandles.map((dir) => (
                  <div
                    key={dir}
                    className={`modal-resize-handle ${
                      dir.length === 1 ? "edge" : "corner"
                    } ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
                    {...getResizeHandleProps(dir)}
                  />
                ))}
              </>
            )}
            {/* Close Button */}
            <button
              onClick={onClose}
              className="ui-modal-close"
              aria-label="Close"
              data-modal-no-drag
            >
              <FaTimes />
            </button>

            {/* Title */}
            {title && <h2 className="ui-modal-title">{title}</h2>}

            {/* Content */}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
