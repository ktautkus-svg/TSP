import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { ChevronDownIcon } from '@/components/app-icons';
import {
  CALENDAR_PERIOD_PRESETS,
  calendarMonthDays,
  calendarPresetRange,
  dateFromKey,
  formatDateRange,
  localDateKey,
  monthKey,
  shiftMonth,
  type CalendarPeriodPreset,
} from '@/application/reporting/period-range';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { fonts, radius, spacing, type } from '@/ui/tokens';

type PeriodCalendarPickerProps = {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  label?: string;
  presets?: readonly CalendarPeriodPreset[];
  allowClear?: boolean;
  onClear?: () => void;
  testID?: string;
};

const WEEKDAYS = ['Pr', 'An', 'Tr', 'Kt', 'Pn', 'Št', 'Sk'] as const;

/**
 * One compact period control for every report screen. The closed state only
 * occupies one row; opening it keeps the calendar and common period shortcuts
 * in the same panel, so choosing a date never turns into a separate maze of
 * chips, inputs and apply buttons.
 */
export function PeriodCalendarPicker({
  from,
  to,
  onChange,
  label = 'Laikotarpis',
  presets = CALENDAR_PERIOD_PRESETS,
  allowClear = false,
  onClear,
  testID = 'period-calendar-picker',
}: PeriodCalendarPickerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width } = useWindowDimensions();
  const stacked = width < 720;
  const today = useMemo(() => localDateKey(new Date()), []);
  const initialDate = from || to || today;
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from || initialDate);
  const [draftTo, setDraftTo] = useState(to || initialDate);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(monthKey(initialDate));

  useEffect(() => {
    if (!open) return;
    const nextFrom = from || to || today;
    const nextTo = to || from || today;
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    setVisibleMonth(monthKey(nextFrom));
    setSelectingEnd(false);
  }, [from, open, to, today]);

  const days = useMemo(() => calendarMonthDays(visibleMonth), [visibleMonth]);
  const title = new Intl.DateTimeFormat('lt-LT', { year: 'numeric', month: 'long' }).format(dateFromKey(`${visibleMonth}-15`));
  const currentLabel = from && to ? formatDateRange(from, to) : 'Visas laikotarpis';

  const selectDay = (key: string) => {
    if (!selectingEnd) {
      setDraftFrom(key);
      setDraftTo(key);
      setSelectingEnd(true);
      return;
    }
    if (key < draftFrom) {
      setDraftTo(draftFrom);
      setDraftFrom(key);
    } else {
      setDraftTo(key);
    }
    setSelectingEnd(false);
  };

  const apply = () => {
    const first = draftFrom <= draftTo ? draftFrom : draftTo;
    const second = draftFrom <= draftTo ? draftTo : draftFrom;
    onChange(first, second);
    setOpen(false);
  };

  const choosePreset = (preset: CalendarPeriodPreset) => {
    const range = calendarPresetRange(preset.key, new Date());
    onChange(range.from, range.to);
    setOpen(false);
  };

  return <View style={styles.root} testID={testID}>
    <Text style={styles.label}>{label.toUpperCase()}</Text>
    <Pressable
      accessibilityLabel={`${label}: ${currentLabel}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((value) => !value)}
      style={({ pressed }) => [styles.trigger, open && styles.triggerOpen, pressed && styles.pressed]}
      testID={`${testID}-trigger`}>
      <View style={styles.triggerText}>
        <Text style={styles.triggerTitle}>{currentLabel}</Text>
        <Text style={styles.triggerHint}>{open ? 'Uždaryti kalendorių' : 'Keisti datą ar laikotarpį'}</Text>
      </View>
      <View style={[styles.chevron, open && styles.chevronOpen]}><ChevronDownIcon color={colors.info} size={20} /></View>
    </Pressable>

    {open ? <View style={[styles.panel, stacked && styles.panelStacked]} testID={`${testID}-panel`}>
      <View style={styles.calendar}>
        <View style={styles.monthHeader}>
          <Pressable accessibilityLabel="Ankstesnis mėnuo" onPress={() => setVisibleMonth(shiftMonth(visibleMonth, -1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{capitalize(title)}</Text>
          <Pressable accessibilityLabel="Kitas mėnuo" onPress={() => setVisibleMonth(shiftMonth(visibleMonth, 1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>›</Text>
          </Pressable>
        </View>
        <View style={styles.weekRow}>
          {WEEKDAYS.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
        </View>
        <View style={styles.dayGrid}>
          {days.map((day) => {
            const selected = day.key === draftFrom || day.key === draftTo;
            const inRange = day.key > draftFrom && day.key < draftTo;
            return <Pressable
              accessibilityLabel={day.key}
              accessibilityState={{ selected: selected || inRange }}
              key={day.key}
              onPress={() => selectDay(day.key)}
              style={({ pressed }) => [styles.day, inRange && styles.dayInRange, selected && styles.daySelected, pressed && styles.pressed]}
              testID={`${testID}-day-${day.key}`}>
              <Text style={[styles.dayText, !day.inMonth && styles.dayOutside, selected && styles.dayTextSelected, day.key === today && !selected && styles.dayToday]}>{day.day}</Text>
            </Pressable>;
          })}
        </View>
        <Text style={styles.selectionHint}>{selectingEnd ? 'Pasirinkite laikotarpio pabaigą' : `${formatDateRange(draftFrom, draftTo)} pasirinkta`}</Text>
        <Pressable onPress={apply} style={styles.applyButton} testID={`${testID}-apply`}>
          <Text style={styles.applyText}>Taikyti</Text>
        </Pressable>
      </View>

      <View style={[styles.shortcuts, stacked && styles.shortcutsStacked]}>
        <Text style={[styles.shortcutsTitle, stacked && styles.shortcutsTitleStacked]}>Greitas pasirinkimas</Text>
        {presets.map((preset) => <Pressable
          key={preset.key}
          onPress={() => choosePreset(preset)}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
          testID={`${testID}-preset-${preset.key}`}>
          <Text style={styles.shortcutText}>{preset.label}</Text>
        </Pressable>)}
        {allowClear ? <Pressable onPress={() => { onClear?.(); setOpen(false); }} style={styles.clearButton} testID={`${testID}-clear`}>
          <Text style={styles.clearText}>Visas laikotarpis</Text>
        </Pressable> : null}
      </View>
    </View> : null}
  </View>;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  root: { gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },
  trigger: { minHeight: 58, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  triggerOpen: { borderColor: colors.info },
  triggerText: { flex: 1, minWidth: 0 },
  triggerTitle: { ...type.bodyStrong, color: colors.text },
  triggerHint: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  chevron: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  panel: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  panelStacked: { flexDirection: 'column' },
  calendar: { flex: 1, minWidth: 0, gap: spacing.sm },
  monthHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  monthButtonText: { fontFamily: fonts.heading, fontSize: 30, lineHeight: 34, color: colors.info },
  monthTitle: { ...type.sectionTitle, color: colors.text, textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  weekday: { width: '14.285%', textAlign: 'center', ...type.meta, color: colors.textMuted },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: '14.285%', minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  dayInRange: { backgroundColor: colors.infoSoft, borderRadius: 0 },
  daySelected: { backgroundColor: colors.info },
  dayText: { ...type.secondaryStrong, color: colors.text },
  dayOutside: { color: colors.textMuted },
  dayTextSelected: { color: colors.textInverse },
  dayToday: { color: colors.info, textDecorationLine: 'underline' },
  selectionHint: { ...type.meta, color: colors.textMuted, textAlign: 'center' },
  applyButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.actionPrimary },
  applyText: { ...type.button, color: colors.textInverse },
  shortcuts: { width: 220, paddingLeft: spacing.md, borderLeftWidth: 1, borderLeftColor: colors.borderSubtle, gap: spacing.xs },
  shortcutsStacked: { width: '100%', paddingLeft: 0, paddingTop: spacing.md, borderLeftWidth: 0, borderTopWidth: 1, borderTopColor: colors.borderSubtle, flexDirection: 'row', flexWrap: 'wrap' },
  shortcutsTitle: { ...type.label, color: colors.textMuted, marginBottom: spacing.xs },
  shortcutsTitleStacked: { width: '100%' },
  shortcut: { minHeight: 44, minWidth: '45%', flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle },
  shortcutText: { ...type.bodyStrong, color: colors.textSecondary },
  clearButton: { minHeight: 44, minWidth: '45%', flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong },
  clearText: { ...type.bodyStrong, color: colors.info },
  pressed: { opacity: 0.78 },
});
