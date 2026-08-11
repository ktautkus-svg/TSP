import { Link, type Href } from 'expo-router';
import { Pressable, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { fonts, type } from '@/ui/tokens';

/**
 * Home navigation helper.
 *
 * "Pradžia" always means replace → `/` (dashboard), never Back.
 * Route screens (loading / edit / alternatives) should keep the default
 * Stack headerRight from `_layout` which already uses this pattern, or reuse
 * `HomeLink` instead of overriding Pradžia to `router.back()`.
 */
export function homeHref(): Href {
  return '/' as Href;
}

type HomeLinkProps = {
  label?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
};

export function HomeLink({
  label = 'Pradžia',
  style,
  textStyle,
  testID = 'nav-home',
}: HomeLinkProps) {
  return (
    <Link href={homeHref()} replace asChild>
      <Pressable accessibilityRole="button" style={style} testID={testID}>
        <Text style={[{ ...type.secondary, fontFamily: fonts.headingSemiBold, color: '#FFFFFF' }, textStyle]}>
          {label}
        </Text>
      </Pressable>
    </Link>
  );
}
