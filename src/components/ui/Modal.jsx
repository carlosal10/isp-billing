import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaTimes } from "react-icons/fa";


export function Modal({ open, onClose, title, children, minWidth = 520, minHeight = 420, defaultSize }) {





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

            className="ui-modal-surface dialog-surface"
            role="dialog"
            aria-modal="true"
            aria-label={title || "Dialog"}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
          >
            <button
              onClick={onClose}
              className="ui-modal-close"
              aria-label="Close"

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
