import { createPortal } from 'react-dom';
import type React from 'react';

/**
 * Render pop-ups (menus, previews, photo viewer, sheets) at the top of the page.
 * Anything inside the message box (which has a blur effect) or a scrolled pane
 * would otherwise be trapped in that small area instead of covering the screen.
 */
export const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  typeof document === 'undefined' ? null : createPortal(children, document.body);
