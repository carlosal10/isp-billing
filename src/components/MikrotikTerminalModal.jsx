// components/MikrotikTerminalModal.jsx
import { useEffect, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import './MikrotikTerminalModal.css';
import { api } from '../lib/apiClient';
import { useServer } from '../context/ServerContext';

export default function MikrotikTerminalModal({ isOpen, onClose }) {
  const [cmd, setCmd] = useState('/system/resource/print');
  const [out, setOut] = useState([]);
  const { servers, selected, setSelected, reload } = useServer();

  if (!isOpen) return null;

  const run = async () => {
    setOut(o => [...o, `> ${cmd}`]);
    try {
      const { data } = await api.post('/mikrotik/terminal/exec', { command: cmd });
      if (!data?.ok) {
        setOut(o => [...o, `ERR: ${data?.error || 'request failed'}`]);
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
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
          <label style={{ fontSize:12 }}>Server:</label>
          <select value={selected || ''} onChange={(e)=>setSelected(e.target.value)}>
            {(servers||[]).map(s => (
              <option key={s.id} value={s.id}>{s.primary ? '★ ' : ''}{s.name} ({s.host})</option>
            ))}
          </select>
          <button onClick={reload} style={{ fontSize:12 }}>Reload</button>
        </div>

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
