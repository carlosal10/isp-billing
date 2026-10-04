import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useServer } from '../context/ServerContext';
import { Modal } from './ui/Modal';
import RouterConnectionForm from './RouterConnectionForm';
export default function ConnectMikrotik({ isOpen = false, onClose, standalone = false }) {
  const { role } = useAuth();
  const { reload } = useServer();
  const content = <><p className="network-note">A public router IP is optional. A cloud billing server can manage a private router through a VPN route. The address below must be reachable from the server.</p><RouterConnectionForm onSaved={() => reload()} /></>;
  if (!['owner', 'admin'].includes(role)) return standalone ? <main className="workspace-page"><h1>Connect a router</h1><p>Owner or administrator access is required.</p></main> : null;
  return standalone ? <main className="workspace-page network-workspace"><header className="workspace-header"><div><span className="eyebrow">NETWORK OPERATIONS</span><h1>Connect a router</h1><p>Add a management connection to your MikroTik router.</p></div></header><section className="workspace-card">{content}</section></main>
    : <Modal open={isOpen} onClose={onClose} title="Connect a router">{content}</Modal>;
}
