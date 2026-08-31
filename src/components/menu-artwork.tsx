import { Image, StyleSheet, View } from 'react-native';

import { radius } from '@/ui/tokens';

const MENU_ARTWORK = require('../../assets/images/menu/tsp-menu-artwork.png');
const MENU_SECONDARY_ARTWORK = require('../../assets/images/menu/tsp-menu-secondary-3d.png');
const MENU_SERVICE_ARTWORK = require('../../assets/images/menu/tsp-menu-service-3d.png');
const MENU_FUEL_ARTWORK = require('../../assets/images/menu/tsp-menu-fuel-3d.png');

const SOURCE_WIDTH = 768;
const SOURCE_HEIGHT = 1365;
const CROP_SIZE = 148;

const artworkCrops = {
  dispatch: { x: 48, y: 340 },
  execute: { x: 48, y: 520 },
  quality: { x: 48, y: 710 },
  'trip-sheet': { x: 48, y: 900 },
  settings: { x: 48, y: 1090 },
} as const;

const artworkAliases = {
  route: 'execute',
} as const;

const SECONDARY_SOURCE_WIDTH = 1280;
const SECONDARY_SOURCE_HEIGHT = 512;
const SECONDARY_COLUMNS = 5;
const SECONDARY_ROWS = 2;
const SECONDARY_CELL_WIDTH = SECONDARY_SOURCE_WIDTH / SECONDARY_COLUMNS;
const SECONDARY_CELL_HEIGHT = SECONDARY_SOURCE_HEIGHT / SECONDARY_ROWS;

/** Distinct 3D objects generated as one coherent set from the approved Stitch
 * artwork. The position is a zero-based column/row inside the 5×2 sprite. */
const secondaryArtwork = {
  edit: { column: 0, row: 0 },
  drivers: { column: 1, row: 0 },
  vehicles: { column: 2, row: 0 },
  finance: { column: 3, row: 0 },
  clients: { column: 4, row: 0 },
  history: { column: 0, row: 1 },
  statistics: { column: 1, row: 1 },
  navigation: { column: 2, row: 1 },
  account: { column: 3, row: 1 },
  logout: { column: 4, row: 1 },
} as const;

type DirectArtworkKind = 'service' | 'fuel';

export type MenuArtworkKind = keyof typeof artworkCrops | keyof typeof artworkAliases | keyof typeof secondaryArtwork | DirectArtworkKind;

/**
 * Operational menu artwork based on the approved Stitch menu direction.
 * The five primary illustrations are clipped directly from the selected local
 * design so their appearance stays identical. Additional actions use a single
 * matched 3D sprite instead of emoji, clipart or duplicated illustrations.
 */
export function MenuArtwork({ kind, size = 58 }: { kind: MenuArtworkKind; size?: number }) {
  const resolvedKind = kind in artworkAliases
    ? artworkAliases[kind as keyof typeof artworkAliases]
    : kind;
  if (resolvedKind in artworkCrops) {
    const crop = artworkCrops[resolvedKind as keyof typeof artworkCrops];
    const scale = size / CROP_SIZE;
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <Image
          resizeMode="stretch"
          source={MENU_ARTWORK}
          style={{
            position: 'absolute',
            left: -crop.x * scale,
            top: -crop.y * scale,
            width: SOURCE_WIDTH * scale,
            height: SOURCE_HEIGHT * scale,
          }}
        />
      </View>
    );
  }

  if (kind === 'service' || kind === 'fuel') {
    return (
      <View style={[styles.frame, { width: size, height: size }]}>
        <Image resizeMode="contain" source={kind === 'fuel' ? MENU_FUEL_ARTWORK : MENU_SERVICE_ARTWORK} style={styles.directImage} />
      </View>
    );
  }

  const crop = secondaryArtwork[kind as keyof typeof secondaryArtwork];
  const scale = size / SECONDARY_CELL_WIDTH;
  return (
    <View style={[styles.frame, { width: size, height: size }]}>
      <Image
        resizeMode="stretch"
        source={MENU_SECONDARY_ARTWORK}
        style={{
          position: 'absolute',
          left: -crop.column * SECONDARY_CELL_WIDTH * scale,
          top: -crop.row * SECONDARY_CELL_HEIGHT * scale,
          width: SECONDARY_SOURCE_WIDTH * scale,
          height: SECONDARY_SOURCE_HEIGHT * scale,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
  },
  directImage: { width: '100%', height: '100%' },
});
