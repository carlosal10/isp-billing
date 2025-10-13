import { useEffect, useRef, useState } from "react";
import { FaTimes } from "react-icons/fa";
import "./MikrotikTerminalModal.css";
import { api } from "../lib/apiClient";
import { useServer } from "../context/ServerContext";
import useDragResize from "../hooks/useDragResize";

export default function MikrotikTerminalModal({ isOpen, onClose }) {
  const [cmd, setCmd] = useState("/system/resource/print");
  const [out, setOut] = useState([]);
  const { servers, selected, setSelected, reload } = useServer();
  const containerRef = useRef(null);
  const dragHandleRef = useRef(null);
  const { getResizeHandleProps } = useDragResize({
    isOpen,
    containerRef,
    handleRef: dragHandleRef,
    minWidth: 680,
    minHeight: 560,
    defaultSize: { width: 920, height: 640 },
  });
  const resizeHandles = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  if (!isOpen) return null;

  const run = async () => {
    setOut((o) => [...o, `> ${cmd}`]);
    try {
      const { data } = await api.post("/mikrotik/terminal/exec", { command: cmd });
      if (!data?.ok) {
        setOut((o) => [...o, `ERR: ${data?.error || "request failed"}`]);
      } else {
        setOut((o) => [...o, JSON.stringify(data.result, null, 2)]);
      }
    } catch (e) {
      setOut((o) => [...o, `ERR: ${e.message}`]);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  };

  return (
    <div
      className="ps-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div ref={containerRef} className="ps-modal draggable-modal">
        <div className="modal-drag-bar" ref={dragHandleRef}>
          Drag
        </div>
        {resizeHandles.map((dir) => (
          <div
            key={dir}
            className={`modal-resize-handle ${
              dir.length === 1 ? "edge" : "corner"
            } ${["n", "s"].includes(dir) ? "horizontal" : ""} ${["e", "w"].includes(dir) ? "vertical" : ""} ${dir}`}
            {...getResizeHandleProps(dir)}
          />
        ))}
        {/* Close */}
        <button className="ps-close" onClick={onClose} aria-label="Close" data-modal-no-drag>
          <FaTimes size={18} />
        </button>

        {/* Header */}
        <header className="ps-head">
          <span className="ps-chip">Network</span>
          <h2>MikroTik Terminal</h2>
        </header>

        {/* Toolbar */}
        <div className="ps-tabs mtk-toolbar">
          <div className="mtk-toolbar-left">
            <label className="ps-subtitle mtk-toolbar-label" htmlFor="mtk-server">
              Server
            </label>
            <select
              id="mtk-server"
              className="ps-input mtk-select"
              value={selected || ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {(servers || []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.primary ? "★ " : ""}
                  {s.name} ({s.host})
                </option>
              ))}
            </select>
          </div>
          <div className="mtk-toolbar-actions">
            <button type="button" className="ps-tab" onClick={reload}>
              Reload
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="ps-form mtk-body">
          <div className="mtk-input-row">
            <label className="ps-subtitle" htmlFor="mtk-cmd">
              Command
            </label>
            <textarea
              id="mtk-cmd"
              className="ps-input mtk-textarea"
              rows={2}
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. /ppp/secret/print ?name=PEW53I59CP"
            />
            <button type="button" className="ps-submit mtk-run" onClick={run}>
              Run (Ctrl/Cmd + Enter)
            </button>
          </div>

          <div className="mtk-term-wrap">
            <div className="mtk-term-head">Output</div>
            <pre className="mtk-terminal" aria-live="polite">
{out.join("\n")}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
