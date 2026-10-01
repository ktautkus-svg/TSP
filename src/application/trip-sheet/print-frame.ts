/** Print a prepared HTML document from a hidden iframe. Chrome then has no app URL to stamp. */
export function printHtmlDocument(html: string): void {
  if (typeof document === 'undefined') return;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-testid', 'trip-sheet-print-frame');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  // srcdoc keeps the frame document on about:srcdoc, so Chrome's print
  // footer has no app URL to stamp on the page. (document.write would
  // inherit the parent's URL.)
  iframe.srcdoc = html;
  const cleanup = () => {
    iframe.remove();
    iframe.contentWindow?.removeEventListener('afterprint', cleanup);
  };
  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      iframe.remove();
      return;
    }
    frameWindow.addEventListener('afterprint', cleanup);
    requestAnimationFrame(() => frameWindow.print());
  };
  document.body.appendChild(iframe);
  window.setTimeout(cleanup, 60_000);
}
