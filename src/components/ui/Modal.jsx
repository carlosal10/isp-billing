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
          className="fixed inset-0 flex items-center justify-center bg-black/50 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={containerRef}
            className="bg-white rounded-2xl shadow-xl p-6 relative draggable-modal"
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
              className="absolute top-3 right-3 text-gray-500 hover:text-black"
              aria-label="Close"
              data-modal-no-drag
            >
              <FaTimes />
            </button>

            {/* Title */}
            {title && <h2 className="text-xl font-semibold mb-4">{title}</h2>}

            {/* Content */}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
