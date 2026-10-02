import React, { useRef } from 'react';
import { FaTimes } from 'react-icons/fa';
import { useDialogFocus } from '../../hooks/useDialogFocus';

export function Modal({ open, onClose, title, children }) {
  const surface = useRef(null);
  useDialogFocus(open, surface, onClose);
  if (!open) return null;
  return <div className="ui-modal-backdrop">
    <div className="ui-modal-surface dialog-surface" ref={surface} tabIndex={-1}
      role="dialog" aria-modal="true" aria-label={title || 'Dialog'}>
      <button type="button" onClick={onClose} className="ui-modal-close" aria-label="Close"><FaTimes /></button>
      {title && <h2 className="ui-modal-title">{title}</h2>}
      {children}
    </div>
  </div>;
}
