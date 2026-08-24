import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="lt">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#15174C" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="TSP" />
        <meta name="application-name" content="TSP – Tikslus siuntų pristatymas" />
        <meta
          name="description"
          content="Tikslus siuntų maršruto planavimas ir pristatymo vykdymas."
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/tsp-apple-touch-icon.png" />
        {/* Served from our own origin so the service worker can precache it and
            the map still renders offline. Copied by scripts/sync-leaflet-css.mjs. */}
        <link rel="stylesheet" href="/leaflet.css" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root { width: 100vw; min-width: 0; min-height: 100%; max-width: 100vw; background: #F7F9FC; overflow-x: hidden; }
          html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
          html, body { overscroll-behavior-x: none; }
          body { margin: 0; touch-action: pan-y; }
          #root > div { min-width: 0 !important; max-width: 100vw !important; overflow-x: hidden !important; }
          input, textarea, select { font-size: 16px !important; }
          * { box-sizing: border-box; }
          .leaflet-container { position: relative; width: 100%; height: 100%; overflow: hidden; }
          .leaflet-pane, .leaflet-tile, .leaflet-marker-icon, .leaflet-marker-shadow,
          .leaflet-tile-container, .leaflet-pane > svg, .leaflet-pane > canvas {
            position: absolute; left: 0; top: 0;
          }
          .leaflet-container img.leaflet-tile { max-width: none !important; max-height: none !important; }
          @media print {
            @page { size: A4 landscape; margin: 10mm; }
            html, body, #root { background: #FFFFFF !important; overflow: visible !important; }
            [data-testid="trip-sheet-controls"],
            [data-testid="trip-sheet-vehicle-filter"],
            [data-testid="trip-sheet-driver-filter"],
            [data-testid="trip-sheet-month-filter"],
            [data-testid="generate-trip-sheet"],
            [data-testid="trip-sheet-screen-view"] { display: none !important; }
            [data-testid="trip-sheet-print-view"] { display: flex !important; }
            [data-testid^="monthly-trip-sheet-"] { break-after: page; page-break-after: always; }
            [data-testid^="monthly-trip-sheet-"]:last-of-type { break-after: auto; page-break-after: auto; }
          }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
