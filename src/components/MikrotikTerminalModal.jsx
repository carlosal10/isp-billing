// components/MikrotikTerminalModal.jsx
import { useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import './MikrotikTerminalModal.css';


const API = 'https://isp-billing-uq58.onrender.com/api/mikrotik/terminal/exec';

export default function MikrotikTerminalModal({ isOpen, onClose, authToken }) {
  const [cmd, setCmd] = useState('/system/resource/print');
  const [out, setOut] = useState([]);

  if (!isOpen) return null;

  const run = async () => {
    setOut(o => [...o, `> ${cmd}`]);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ command: cmd })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setOut(o => [...o, `ERR: ${data.error || res.statusText}`]);
      } else {
        setOut(o => [...o, JSON.stringify(data.result, null, 2)]);
      }
    } catch (e) {
      setOut(o => [...o, `ERR: ${e.message}`]);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content large">
        <button className="close" onClick={onClose}><FaTimes /></button>
        <h2>MikroTik Terminal</h2>

        <textarea
          rows={2}
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder='e.g. /ppp/secret/print ?name=PEW53I59CP'
        />
        <button onClick={run}>Run (Ctrl/Cmd+Enter)</button>

        <pre className="terminal-output">
{out.join('\n')}
        </pre>
      </div>
    </div>
  );
}
