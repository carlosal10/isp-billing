import React, { useRef } from "react";
import { FaTimes } from "react-icons/fa";
import { MdAdd } from "react-icons/md";
import { AiOutlineEdit } from "react-icons/ai";
import { RiDeleteBinLine } from "react-icons/ri";
import useDragResize from "../hooks/useDragResize";

export default function BillingModal({ isOpen, onClose }) {
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps, isDraggingEnabled } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 420,
    minHeight: 420,
    defaultSize: { width: 520, height: 560 },
  });

  if (!isOpen) return null;

  const handles = isDraggingEnabled ? ["n", "s", "e", "w", "ne", "nw", "se", "sw"] : [];

  return (
    <div className="modal-overlay">
      <div ref={containerRef} className="modal-content draggable-modal">
        {isDraggingEnabled && (
          <>
            <div className="modal-drag-bar" ref={dragHandleRef}>
              Drag
            </div>
            {handles.map((dir) => (
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
        <span className="close" onClick={onClose} data-modal-no-drag>
          <FaTimes />
        </span>

        <h2>Manage Billing</h2>

        {/* Add Bill */}
        <form id="addBillForm">
          <input type="text" placeholder="Customer ID / Username" required />
          <input type="number" placeholder="Amount (KES)" required />
          <input type="date" required />
          <button type="submit">
            <MdAdd className="inline-icon" /> Add Bill
          </button>
        </form>

        {/* Update Bill */}
        <form id="updateBillForm">
          <input type="text" placeholder="Bill ID" required />
          <input type="number" placeholder="New Amount (KES)" />
          <select>
            <option value="">Select Payment Status</option>
            <option value="paid">Paid</option>
            <option value="pending">Pending</option>
          </select>
          <button type="submit">
            <AiOutlineEdit className="inline-icon" /> Update Bill
          </button>
        </form>

        {/* Remove Bill */}
        <form id="removeBillForm">
          <input type="text" placeholder="Bill ID" required />
          <button type="submit" className="remove-btn">
            <RiDeleteBinLine className="inline-icon" /> Remove Bill
          </button>
        </form>
      </div>
    </div>
  );
}
