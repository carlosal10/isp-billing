import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useServer } from '../context/ServerContext';
import { useAuth } from '../context/AuthContext';
import { Modal } from './ui/Modal';
import NetworkSubscribers from './NetworkSubscribers';
import '../network.css';
export default function PppoeModal({ isOpen = false, onClose, standalone = false }) {
  const { selected, servers } = useServer(), { role } = useAuth();
  const [params] = useSearchParams();
  if (!standalone && !isOpen) return null;
  const content = <NetworkSubscribers routers={servers || []} selected={selected} canManage={['owner', 'admin'].includes(role)} serviceType="pppoe" customerId={params.get('customerId') || undefined} />;
  return standalone ? <main className="workspace-page network-workspace"><header className="workspace-header"><div><span className="eyebrow">SUBSCRIBER ACCESS</span><h1>PPPoE services</h1><p>Manage customer-linked PPPoE accounts. Customers and this page share the same service records and actions.</p></div></header>{content}</main> : <Modal open={isOpen} onClose={onClose} title="PPPoE services">{content}</Modal>;
}
