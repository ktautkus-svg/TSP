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
        <meta name="theme-color" content="#142832" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="TSP" />
        <meta name="application-name" content="TSP – Maršrutai ir pristatymai" />
        <meta
          name="description"
          content="Maršrutų planavimas ir pristatymų vykdymas."
        />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root { width: 100vw; min-width: 0; min-height: 100%; max-width: 100vw; background: #F3F6F8; overflow-x: hidden; }
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
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
