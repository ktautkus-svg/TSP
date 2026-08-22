import { Image, StyleSheet, Text, View } from 'react-native';

import { radius } from '@/ui/tokens';

const MENU_ARTWORK = require('../../assets/images/menu/tsp-menu-artwork.png');

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

/** Distinct objects for secondary actions that were previously aliased to the
 * same five Stitch crops. Different actions must never look identical. */
const emojiArtwork = {
  edit: '📝',
  drivers: '👥',
  vehicles: '🚚',
  finance: '💶',
  history: '🗂️',
  statistics: '📊',
  navigation: '☎️',
  account: '👤',
  clients: '🏢',
  logout: '🚪',
} as const;

export type MenuArtworkKind = keyof typeof artworkCrops | keyof typeof artworkAliases | keyof typeof emojiArtwork;

/**
 * Operational menu artwork based on the approved Stitch menu direction.
 * The five primary illustrations are clipped directly from the selected local
 * design so their appearance stays identical. Additional actions use the same
 * compact, object-like visual language instead of mixing in unrelated line art.
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

  const emoji = emojiArtwork[kind as keyof typeof emojiArtwork] ?? '•';
  return (
    <View style={[styles.emojiFrame, { width: size, height: size }]}>
      <Text style={{ fontSize: size * 0.62, lineHeight: size * 0.78 }}>
        {emoji}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
  },
  emojiFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
  },
});
