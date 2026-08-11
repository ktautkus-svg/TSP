import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import type { FuelType } from '@/domain/vehicle-and-trip';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const fuelOptions: Array<{ value: FuelType; label: string }> = [
  { value: 'diesel', label: 'Dyzelinas' },
  { value: 'petrol', label: 'Benzinas' },
  { value: 'electric', label: 'Elektra' },
  { value: 'hybrid', label: 'Hibridas' },
  { value: 'lpg', label: 'Dujos' },
  { value: 'other', label: 'Kita' },
];

export default function VehicleScreen() {
  const db = useSQLiteContext();
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('Darbinis automobilis');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void repository.getVehicle().then((vehicle) => {
      if (!vehicle) return;
      setName(vehicle.name);
      setRegistrationNumber(vehicle.registrationNumber === 'NENURODYTA' ? '' : vehicle.registrationNumber);
      setFuelType(vehicle.fuelType);
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Automobilio duomenų atkurti nepavyko.'));
  }, [repository]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await repository.saveVehicle({ name, registrationNumber, fuelType });
      setMessage('Transporto priemonė išsaugota.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoundationScreen showFoundationNotice={false} title="Transporto priemonė" description="Minimalūs duomenys kelionės lapui.">
      <View style={styles.card}>
        <Text style={styles.label}>Pavadinimas</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Darbinis automobilis" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Valstybinis numeris</Text>
        <TextInput value={registrationNumber} onChangeText={setRegistrationNumber} autoCapitalize="characters" style={styles.input} placeholder="Nebūtina pradžiai" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Kuro rūšis</Text>
        <View style={styles.options}>
          {fuelOptions.map((option) => (
            <Pressable key={option.value} onPress={() => setFuelType(option.value)} style={[styles.option, fuelType === option.value && styles.optionSelected]}>
              <Text style={[styles.optionText, fuelType === option.value && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Pressable disabled={busy} onPress={() => { void save(); }} style={[styles.button, busy && styles.disabled]} testID="save-vehicle">
        <Text style={styles.buttonText}>{busy ? 'Saugoma…' : 'Išsaugoti'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  label: { ...type.cardTitle, color: colors.text },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  optionText: { ...type.secondaryStrong, color: colors.text },
  optionTextSelected: { color: colors.textInverse },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  disabled: { opacity: 0.55 },
  message: { color: colors.textMuted, lineHeight: 20 },
});
