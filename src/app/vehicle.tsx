import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { useLocalAccess } from '@/application/auth/local-access-context';
import { reportVehicleFault } from '@/application/operations/vehicle-fault-report';
import { FoundationScreen } from '@/components/foundation-screen';
import { TripSheetRepository } from '@/database/repositories/trip-sheet-repository';
import { VehicleFaultRepository } from '@/database/repositories/vehicle-fault-repository';
import { evaluateDepartureReadiness } from '@/domain/departure-readiness';
import type { FuelType, VehicleFault } from '@/domain/vehicle-and-trip';
import { radius, spacing, type } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

const fuelOptions: { value: FuelType; label: string }[] = [
  { value: 'diesel', label: 'Dyzelinas' },
  { value: 'petrol', label: 'Benzinas' },
  { value: 'electric', label: 'Elektra' },
  { value: 'hybrid', label: 'Hibridas' },
  { value: 'lpg', label: 'Dujos' },
  { value: 'other', label: 'Kita' },
];

export default function VehicleScreen() {
  const db = useSQLiteContext();
  const { profile, online } = useLocalAccess();
  const repository = useMemo(() => new TripSheetRepository(db), [db]);
  const faults = useMemo(() => new VehicleFaultRepository(db), [db]);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [name, setName] = useState('Darbinis automobilis');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [fuelType, setFuelType] = useState<FuelType>('diesel');
  const [inspectionDueOn, setInspectionDueOn] = useState('');
  const [roadTaxDueOn, setRoadTaxDueOn] = useState('');
  const [serviceDueOn, setServiceDueOn] = useState('');
  const [serviceOdometer, setServiceOdometer] = useState('');
  const [faultComment, setFaultComment] = useState('');
  const [openFaults, setOpenFaults] = useState<VehicleFault[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const vehicle = await repository.getVehicle();
    if (!vehicle) return;
    setName(vehicle.name);
    setRegistrationNumber(vehicle.registrationNumber === 'NENURODYTA' ? '' : vehicle.registrationNumber);
    setFuelType(vehicle.fuelType);
    setInspectionDueOn(vehicle.technicalInspectionDueOn ?? '');
    setRoadTaxDueOn(vehicle.roadTaxDueOn ?? '');
    setServiceDueOn(vehicle.nextServiceDueOn ?? '');
    setServiceOdometer(vehicle.nextServiceOdometer === null ? '' : String(vehicle.nextServiceOdometer));
    setOpenFaults(await faults.listOpen(vehicle.id));
  }, [faults, repository]);

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Automobilio duomenų atkurti nepavyko.'));
  }, [load]);

  const preview = evaluateDepartureReadiness({
    vehicle: {
      id: 'preview',
      registrationNumber,
      technicalInspectionDueOn: inspectionDueOn || null,
      roadTaxDueOn: roadTaxDueOn || null,
      nextServiceDueOn: serviceDueOn || null,
    },
    faults: openFaults,
  });

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const odometer = serviceOdometer.trim() ? Number(serviceOdometer.replace(',', '.')) : null;
      if (odometer !== null && (!Number.isFinite(odometer) || odometer < 0)) {
        throw new Error('Priežiūros odometras turi būti teigiamas skaičius.');
      }
      await repository.saveVehicle({
        name,
        registrationNumber,
        fuelType,
        technicalInspectionDueOn: inspectionDueOn,
        roadTaxDueOn,
        nextServiceDueOn: serviceDueOn,
        nextServiceOdometer: odometer,
      });
      setMessage('Transporto priemonė išsaugota. Tušti terminai darbo nestabdo.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const addFault = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const vehicle = await repository.ensureVehicle();
      await reportVehicleFault(db, {
        vehicleId: vehicle.id,
        registrationNumber: vehicle.registrationNumber,
        comment: faultComment,
        reportedBy: profile.id,
      }, online);
      setFaultComment('');
      setMessage(online
        ? 'Neskubus gedimas išsaugotas ir perduotas administracijai. Važiuoti galima.'
        : 'Neskubus gedimas išsaugotas. Prisijungus jis bus perduotas administracijai.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gedimo išsaugoti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FoundationScreen
      showFoundationNotice={false}
      title="Automobilio priežiūra"
      description="Terminų galima nesuvesti – darbas netrukdomas. Kai data jau įrašyta ir pasibaigusi, maršruto pradėti neleis.">
      <View style={styles.card}>
        <Text style={styles.label}>Pavadinimas</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Darbinis automobilis" placeholderTextColor={colors.textMuted} />
        <Text style={styles.label}>Valstybinis numeris</Text>
        <TextInput value={registrationNumber} onChangeText={setRegistrationNumber} autoCapitalize="characters" style={styles.input} placeholder="Nebūtina pradžiai" placeholderTextColor={colors.textMuted} testID="vehicle-registration" />
        <Text style={styles.label}>Kuro rūšis</Text>
        <View style={styles.options}>
          {fuelOptions.map((option) => (
            <Pressable key={option.value} onPress={() => setFuelType(option.value)} style={[styles.option, fuelType === option.value && styles.optionSelected]}>
              <Text style={[styles.optionText, fuelType === option.value && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.card} testID="vehicle-compliance-card">
        <Text style={styles.sectionTitle}>Priežiūros terminai</Text>
        <Text style={styles.hint}>Datos formatu YYYY-MM-DD. Tuščia data nestoja darbo. Suvedus ir pasibaigus – važiuoti neleis.</Text>
        <Text style={styles.label}>Techninė apžiūra iki</Text>
        <TextInput value={inspectionDueOn} onChangeText={setInspectionDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-inspection-due" />
        <Text style={styles.label}>Kelių mokestis iki</Text>
        <TextInput value={roadTaxDueOn} onChangeText={setRoadTaxDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-road-tax-due" />
        <Text style={styles.label}>Kita priežiūra iki</Text>
        <TextInput value={serviceDueOn} onChangeText={setServiceDueOn} autoCapitalize="none" keyboardType="numbers-and-punctuation" style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} testID="vehicle-service-due" />
        <Text style={styles.label}>Priežiūros odometras (nebūtina)</Text>
        <TextInput value={serviceOdometer} onChangeText={setServiceOdometer} keyboardType="decimal-pad" style={styles.input} placeholder="Pvz. 185000" placeholderTextColor={colors.textMuted} />
        {preview.blockers.map((issue) => (
          <Text key={issue.code} style={styles.blockText}>{issue.message}</Text>
        ))}
        {preview.warnings.filter((issue) => issue.code !== 'OPEN_NON_URGENT_FAULT').map((issue) => (
          <Text key={issue.code} style={styles.warnText}>{issue.message}</Text>
        ))}
      </View>
      <View style={styles.card} testID="vehicle-fault-card">
        <Text style={styles.sectionTitle}>Neskubūs gedimai</Text>
        <Text style={styles.hint}>Komentaras nestabdo važiavimo. Jis automatiškai perduodamas administracijai.</Text>
        <TextInput
          value={faultComment}
          onChangeText={setFaultComment}
          multiline
          style={[styles.input, styles.multiline]}
          placeholder="Pvz. tylus ūžesys iš dešinės pusės"
          placeholderTextColor={colors.textMuted}
          testID="vehicle-fault-comment"
        />
        <Pressable disabled={busy || !faultComment.trim()} onPress={() => { void addFault(); }} style={[styles.secondaryButton, (busy || !faultComment.trim()) && styles.disabled]} testID="save-vehicle-fault">
          <Text style={styles.secondaryText}>{busy ? 'Saugoma…' : 'Įrašyti ir perduoti administracijai'}</Text>
        </Pressable>
        {openFaults.map((fault) => (
          <Text key={fault.id} style={styles.faultText}>
            {fault.notifiedAt ? 'Perduota' : 'Laukia perdavimo'} · {fault.comment}
          </Text>
        ))}
      </View>
      <Pressable disabled={busy} onPress={() => { void save(); }} style={[styles.button, busy && styles.disabled]} testID="save-vehicle">
        <Text style={styles.buttonText}>{busy ? 'Saugoma…' : 'Išsaugoti automobilį'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </FoundationScreen>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  sectionTitle: { ...type.cardTitle, color: colors.text },
  label: { ...type.cardTitle, color: colors.text },
  hint: { ...type.secondary, color: colors.textMuted },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceSubtle, color: colors.text, paddingHorizontal: spacing.md, ...type.body },
  multiline: { minHeight: 88, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  optionText: { ...type.secondaryStrong, color: colors.text },
  optionTextSelected: { color: colors.textInverse },
  button: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { ...type.button, color: colors.textInverse, fontSize: 16 },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.55 },
  message: { color: colors.textMuted, lineHeight: 20 },
  blockText: { ...type.bodyStrong, color: colors.danger },
  warnText: { ...type.body, color: colors.warning },
  faultText: { ...type.secondary, color: colors.textSecondary },
});
