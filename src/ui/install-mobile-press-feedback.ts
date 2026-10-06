const STYLE_ID = 'firo-mobile-press-feedback';

const CSS = `
[role="button"], button, a[href] {
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: rgba(21, 23, 76, 0.16);
  transition: transform 70ms ease, filter 70ms ease, opacity 70ms ease;
  user-select: none;
  -webkit-user-select: none;
}
[role="button"]:active, button:active, a[href]:active {
  transform: translateY(1px) scale(0.985);
  filter: brightness(0.96);
}
[role="button"][aria-disabled="true"], button:disabled {
  cursor: default;
  opacity: 0.58;
}
[role="button"][aria-disabled="true"]:active, button:disabled:active {
  transform: none;
  filter: none;
}
@media (prefers-reduced-motion: reduce) {
  [role="button"], button, a[href] { transition: none; }
  [role="button"]:active, button:active, a[href]:active { transform: none; }
}
`;

/** Injects immediate press feedback for the iPhone PWA even if cached HTML is stale. */
export function installMobilePressFeedback(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  const body = document.body;
  if (body && !body.hasAttribute('ontouchstart')) body.setAttribute('ontouchstart', '');
}
