import { useEffect } from 'react';

export function useDialogFocus(open, ref, onClose) {
  useEffect(() => {
    if (!open || !ref.current) return undefined;
    const surface = ref.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...surface.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter(element => element.getClientRects().length);
    (focusable()[0] || surface).focus();
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose?.(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements[elements.length - 1];
      if (!first) { event.preventDefault(); surface.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    surface.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; surface.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [open, ref, onClose]);
}
