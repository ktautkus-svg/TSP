import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useLocalAccess } from '@/application/auth/local-access-context';

import { Alert } from '@/ui/alert';
import { resolveDeliveryAddresses } from '@/application/import/address-resolver';
import { getRouteCreationBlockers, hasRouteCoordinates } from '@/application/import/route-creation-readiness';
import {
  excelPreviewToDraftStops,
  excelPreviewToImportResult,
} from '@/application/import/excel-route-mapper';
import { ImagePreprocessingPipeline } from '@/application/import/image-preprocessing';
import { ImportEngine } from '@/application/import/import-engine';
import {
  filterExcelPreviewByRouteCodes,
  groupExcelRows,
  parseLogisticsExcelWorkbook,
  summarizeExcelRows,
} from '@/application/import/logistics-excel-v1';
import {
  CancelDraftRoute,
  CreateDraftRouteWithStops,
  RouteCommandError,
  type DraftStopInput,
} from '@/application/routes/route-commands';
import {
  importedDeliveriesToDraftStops,
} from '@/application/routes/route-draft-mappers';
import { resolveRoute } from '@/application/routes/route-navigation';
import { defaultPlanningDate, defaultPlanningTime, planningDepartureIso } from '@/application/routes/planning-schedule';
import { GetDefaultLocations, PlanningModePreference, RouteEndPreference, SaveDefaultLocation } from '@/application/routes/saved-locations';
import { confidenceLevel } from '@/domain/import/confidence';
import {
  LOGISTICS_EXCEL_V1,
  type ExcelColumnMapping,
  type ExcelImportPreview,
  type ExcelSourceRow,
} from '@/domain/import/excel-models';
import type { ImportDocument, ImportField, ImportResult, ParsedDelivery } from '@/domain/import/models';
import type { PlanningMode, RouteEndpoint } from '@/domain/route';
import { FoundationScreen } from '@/components/foundation-screen';
import { RouteRepository } from '@/database/repositories/route-repository';
import { ExcelImportRepository } from '@/database/repositories/excel-import-repository';
import { readPickedExcelAsset } from '@/infrastructure/import/excel-file-adapter';
import { ExpoImageTransformAdapter } from '@/infrastructure/import/expo-image-transform-adapter';
import { GatewayAddressResolver } from '@/infrastructure/import/gateway-address-resolver';
import { GoogleVisionOcrProvider } from '@/infrastructure/import/ocr/google-vision-ocr-provider';
import { MockOcrProvider } from '@/infrastructure/import/ocr/mock-ocr-provider';
import { SQLiteImportAuditRepository } from '@/infrastructure/import/sqlite-import-audit-repository';
import { spacing } from '@/ui/tokens';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';

type ManualRowResolution = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  addressValidationState: 'auto_confirmed' | 'unconfirmed';
};

export default function ImportScreen() {
  const { profile } = useLocalAccess();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const excelRepository = useMemo(() => new ExcelImportRepository(db), [db]);
  const [pastedText, setPastedText] = useState('');
  const [document, setDocument] = useState<ImportDocument | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [excelPreview, setExcelPreview] = useState<ExcelImportPreview | null>(null);
  const [excelDuplicate, setExcelDuplicate] = useState<ExcelImportPreview | null>(null);
  const [expandedExcelGroups, setExpandedExcelGroups] = useState<string[]>([]);
  const [showOnlyExcelProblems, setShowOnlyExcelProblems] = useState(true);
  const [excelProblemIndex, setExcelProblemIndex] = useState(0);
  const [showExcelOptions, setShowExcelOptions] = useState(false);
  const [showPasteField, setShowPasteField] = useState(false);
  const [rememberedExcel, setRememberedExcel] = useState<{
    preview: ExcelImportPreview;
    result: ImportResult | null;
  } | null>(null);
  const [movingExcelLineId, setMovingExcelLineId] = useState<string | null>(null);
  const [columnMapping, setColumnMapping] = useState<ExcelColumnMapping>(LOGISTICS_EXCEL_V1.columns);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [endMode, setEndMode] = useState<'warehouse' | 'home'>('warehouse');

  useEffect(() => {
    if (profile.role === 'driver' && !profile.permissions?.canCreateRoutes) router.replace('/' as Href);
  }, [profile, router]);
  const [planningMode, setPlanningMode] = useState<PlanningMode>('with_time_windows');
  const [planningDate, setPlanningDate] = useState(() => defaultPlanningDate());
  const [planningTime, setPlanningTime] = useState(() => defaultPlanningTime());
  const planningTimeTouched = useRef(false);
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [warehouseEndpoint, setWarehouseEndpoint] = useState<RouteEndpoint | null>(null);
  const [homeEndpoint, setHomeEndpoint] = useState<RouteEndpoint | null>(null);
  const addressResolver = useMemo(() => new GatewayAddressResolver(), []);
  const [manualRowResolutions, setManualRowResolutions] = useState<Record<string, ManualRowResolution>>({});
  const creationInFlight = useRef(false);
  const creationCommandId = useRef<string | null>(null);
  const excelBytes = useRef<Uint8Array | null>(null);
  const excelAsset = useRef<{ name: string; hash: string } | null>(null);

  useEffect(() => {
    creationCommandId.current = null;
  }, [result?.auditId]);

  useEffect(() => {
    let active = true;
    // Remember last Excel session as an optional card — do not auto-open the full review.
    void excelRepository.getLatestReview().then((restored) => {
      if (!active || !restored || result || document || excelPreview) return;
      setRememberedExcel(restored);
    }).catch((reason) => {
      if (__DEV__) console.warn('EXCEL_IMPORT_REMEMBER_FAILED', reason);
    });
    return () => { active = false; };
  }, [document, excelPreview, excelRepository, result]);

  useEffect(() => {
    void new GetDefaultLocations(db).execute().then(async ({ warehouse, home }) => {
      const save = new SaveDefaultLocation(db);
      const recover = async (saved: typeof warehouse, kind: 'warehouse' | 'home') => {
        if (!saved || hasRouteCoordinates(saved.endpoint)) return saved?.endpoint ?? null;
        const candidates = await addressResolver.resolve(saved.endpoint.originalAddress).catch(() => []);
        const candidate = candidates.length === 1 ? candidates[0] : null;
        if (!candidate) return saved.endpoint;
        const endpoint: RouteEndpoint = {
          originalAddress: saved.endpoint.originalAddress,
          geocodingQuery: saved.endpoint.geocodingQuery ?? saved.endpoint.originalAddress,
          normalizedAddress: candidate.normalizedAddress,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
        };
        await save.execute(kind, saved.label, endpoint);
        return endpoint;
      };
      const [recoveredWarehouse, recoveredHome] = await Promise.all([
        recover(warehouse, 'warehouse'),
        recover(home, 'home'),
      ]);
      const warehouseValue = recoveredWarehouse?.originalAddress ?? '';
      const homeValue = recoveredHome?.originalAddress ?? '';
      setWarehouseAddress(warehouseValue);
      setHomeAddress(homeValue);
      setWarehouseEndpoint(recoveredWarehouse);
      setHomeEndpoint(recoveredHome);
      return new RouteEndPreference(db).get();
    }).then((preference) => {
      setEndMode(preference);
    }).catch((reason) => {
      if (__DEV__) console.warn('DEFAULT_LOCATIONS_LOAD_FAILED', reason);
      setMessage('Išsaugotų vietų atkurti nepavyko. Galite įvesti vietą ranka.');
    });
  }, [addressResolver, db]);

  useEffect(() => {
    void new PlanningModePreference(db).get()
      .then(setPlanningMode)
      .catch((reason) => {
        if (__DEV__) console.warn('PLANNING_MODE_PREFERENCE_LOAD_FAILED', reason);
      });
  }, [db]);

  useEffect(() => {
    let active = true;
    void repository.getActive()
      .then((route) => {
        if (!active || !route || route.status === 'draft') return;
        const destination = resolveRoute(route);
        router.replace({
          pathname: destination.pathname,
          params: destination.params ? { ...destination.params, redirectReason: 'stale-planning-screen' } : undefined,
        } as Href);
      })
      .catch((reason) => {
        if (__DEV__) console.warn('IMPORT_ROUTE_GUARD_FAILED', reason);
      });
    return () => { active = false; };
  }, [repository, router]);

  const capture = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setMessage('Kameros leidimas nesuteiktas.');
    const selected = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (selected.canceled) return;
    await prepareImages(selected.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? 'camera.jpg' })), 'camera');
  };

  const pickImages = async () => {
    const selected = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 1,
    });
    if (selected.canceled) return;
    await prepareImages(selected.assets.map((asset, index) => ({ uri: asset.uri, name: asset.fileName ?? `page-${index + 1}.jpg` })), 'gallery');
  };

  const prepareImages = async (
    assets: Array<{ uri: string; name: string }>,
    kind: 'camera' | 'gallery',
  ) => {
    setBusy(true);
    setMessage('Ruošiami dokumento puslapiai…');
    try {
      const converted: string[] = [];
      for (const asset of assets) {
        const image = await manipulateAsync(asset.uri, [], { compress: 0.88, format: SaveFormat.JPEG });
        converted.push(image.uri);
      }
      setDocument(makeDocument(kind, converted[0], assets[0]?.name ?? 'document.jpg', 'image/jpeg', converted));
      setResult(null);
      setMessage(`${converted.length} puslapis(-iai) paruoštas OCR.`);
    } finally {
      setBusy(false);
    }
  };

  const pickPdf = async () => {
    const selected = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (selected.canceled) return;
    const asset = selected.assets[0];
    setDocument(makeDocument('pdf', asset.uri, asset.name, 'application/pdf', [asset.uri], asset.size ?? null));
    setResult(null);
    setMessage('PDF paruoštas Google Vision OCR. Sinchroniškai apdorojami pirmi 5 puslapiai.');
  };

  const pickExcel = async () => {
    const selected = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (selected.canceled) return;
    setBusy(true);
    setMessage('Skaitomi Excel langeliai…');
    try {
      const asset = selected.assets[0];
      const read = await readPickedExcelAsset(asset);
      excelBytes.current = read.bytes;
      excelAsset.current = { name: asset.name, hash: read.sha256 };
      const preview = parseLogisticsExcelWorkbook(read.bytes, {
        importId: `excel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        fileName: asset.name,
        fileHash: read.sha256,
      });
      setColumnMapping(preview.mapping);
      const duplicate = await excelRepository.findLatestByFingerprint(read.sha256, preview.selectedSheetName);
      if (duplicate) {
        // Same file already in audit — offer restore without forcing a fresh blank import.
        setExcelDuplicate(duplicate);
        setRememberedExcel({
          preview: duplicate,
          result: await excelRepository.getReviewResult(duplicate.id),
        });
        setMessage('Šis failas jau buvo importuotas. Galite atkurti ankstesnę peržiūrą arba pradėti naują dieną.');
        return;
      }
      setRememberedExcel(null);
      await openExcelPreview(preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel failo perskaityti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const applySuggestedPlanningTime = (_windows: Array<{ from: string | null | undefined }>) => {
    // Import create-flow defaults to 04:00 unless the driver already changed it.
    if (planningTimeTouched.current) return;
    setPlanningTime(defaultPlanningTime());
  };

  const restoreRememberedExcel = async () => {
    if (!rememberedExcel) return;
    setBusy(true);
    try {
      const restoredResult = rememberedExcel.result ?? excelPreviewToImportResult(rememberedExcel.preview);
      const unresolved = restoredResult.deliveries.filter((delivery) =>
        !delivery.selectedAddress || delivery.validationState !== 'valid',
      );
      let recoveredResult = restoredResult;
      if (unresolved.length > 0) {
        const resolved = await resolveDeliveryAddresses(unresolved, addressResolver);
        const resolvedById = new Map(resolved.map((delivery) => [delivery.id, delivery]));
        recoveredResult = {
          ...restoredResult,
          deliveries: restoredResult.deliveries.map((delivery) => resolvedById.get(delivery.id) ?? delivery),
        };
        recoveredResult.requiresReview = recoveredResult.deliveries.some((delivery) =>
          !delivery.selectedAddress || delivery.validationState !== 'valid',
        );
        await excelRepository.saveReviewResult(rememberedExcel.preview.id, recoveredResult);
      }
      setColumnMapping(rememberedExcel.preview.mapping);
      setExcelPreview(rememberedExcel.preview);
      setExcelDuplicate(null);
      setRememberedExcel(null);
      setResult(recoveredResult);
      setDocument(null);
      setExpandedExcelGroups([]);
      setShowOnlyExcelProblems(true);
      setExcelProblemIndex(0);
      setShowExcelOptions(false);
      setMessage(`Atkurtas failas: ${rememberedExcel.preview.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Prisiminto Excel atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const openExcelPreview = async (preview: ExcelImportPreview, restoredResult?: ImportResult | null) => {
    await excelRepository.savePreview(preview);
    const imported = restoredResult ?? excelPreviewToImportResult(preview);
    await excelRepository.saveReviewResult(preview.id, imported);
    setExcelPreview(preview);
    setExcelDuplicate(null);
    setResult(imported);
    applySuggestedPlanningTime(preview.groups.map((group) => ({ from: group.deliveryTimeFrom })));
    setDocument(null);
    setExpandedExcelGroups([]);
    setShowOnlyExcelProblems(true);
    setExcelProblemIndex(0);
    setShowExcelOptions(false);
    setMessage(preview.mappingRecognized
      ? null
      : 'Stulpelių struktūra neatpažinta. Patikrinkite stulpelių susiejimą.');
  };

  const reopenDuplicateExcel = async () => {
    if (!excelDuplicate) return;
    await openExcelPreview(excelDuplicate, await excelRepository.getReviewResult(excelDuplicate.id));
  };

  const importDuplicateAsNewDay = async () => {
    if (!excelBytes.current || !excelAsset.current) return;
    const preview = parseLogisticsExcelWorkbook(excelBytes.current, {
      importId: `excel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      fileName: excelAsset.current.name,
      fileHash: excelAsset.current.hash,
      sheetName: excelDuplicate?.selectedSheetName,
    });
    await openExcelPreview(preview);
  };

  const reparseExcel = async (sheetName?: string, mappingConfirmed = false) => {
    if (!excelBytes.current || !excelAsset.current || !excelPreview) return;
    setBusy(true);
    try {
      const parsed = parseLogisticsExcelWorkbook(excelBytes.current, {
        importId: excelPreview.id,
        fileName: excelAsset.current.name,
        fileHash: excelAsset.current.hash,
        sheetName: sheetName ?? excelPreview.selectedSheetName,
        template: { ...LOGISTICS_EXCEL_V1, columns: columnMapping },
      });
      const preview = mappingConfirmed ? { ...parsed, mappingRecognized: true } : parsed;
      await openExcelPreview(preview);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel lapo perskaityti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const toggleRouteCode = async (code: string) => {
    if (!excelPreview) return;
    let selected = excelPreview.selectedRouteCodes.includes(code)
      ? excelPreview.selectedRouteCodes.filter((value) => value !== code)
      : [...excelPreview.selectedRouteCodes, code];
    if (selected.length === 0) selected = allRouteCodes(excelPreview);
    await openExcelPreview(filterExcelPreviewByRouteCodes(excelPreview, selected));
  };

  const updateExcelRows = async (
    rows: ExcelImportPreview['rows'],
    correction: { targetType: 'row' | 'group'; targetId: string; field: string; previous: unknown; next: unknown },
  ) => {
    if (!excelPreview) return;
    const groups = groupExcelRows(rows);
    const preview = { ...excelPreview, rows, groups, summary: summarizeExcelRows(rows, groups) };
    await excelRepository.recordCorrection({
      id: `correction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      importSessionId: excelPreview.id,
      targetType: correction.targetType,
      targetId: correction.targetId,
      field: correction.field,
      previousValue: correction.previous,
      correctedValue: correction.next,
      createdAt: new Date().toISOString(),
    });
    await openExcelPreview(preview);
  };

  const toggleExcelRow = async (rowId: string) => {
    if (!excelPreview) return;
    const row = excelPreview.rows.find((item) => item.id === rowId);
    if (!row) return;
    await updateExcelRows(
      excelPreview.rows.map((item) => item.id === rowId ? { ...item, excluded: !item.excluded } : item),
      { targetType: 'row', targetId: rowId, field: 'excluded', previous: row.excluded, next: !row.excluded },
    );
  };

  const splitExcelRow = async (rowId: string) => {
    if (!excelPreview) return;
    const row = excelPreview.rows.find((item) => item.id === rowId);
    if (!row) return;
    const key = `manual-split:${row.id}`;
    await updateExcelRows(
      excelPreview.rows.map((item) => item.id === rowId ? { ...item, manualGroupKey: key } : item),
      { targetType: 'row', targetId: rowId, field: 'manualGroupKey', previous: row.manualGroupKey, next: key },
    );
  };

  const moveExcelRow = async (rowId: string, targetGroupKey: string) => {
    if (!excelPreview) return;
    const row = excelPreview.rows.find((item) => item.id === rowId);
    const target = excelPreview.groups.find((group) => group.normalizedAddressKey === targetGroupKey);
    if (!row || !target) return;
    await updateExcelRows(
      excelPreview.rows.map((item) => item.id === rowId
        ? { ...item, normalizedAddress: target.normalizedAddress, manualGroupKey: targetGroupKey }
        : item),
      { targetType: 'row', targetId: rowId, field: 'manualGroupKey', previous: row.manualGroupKey, next: targetGroupKey },
    );
    setMovingExcelLineId(null);
  };

  const mergeExcelGroups = async (sourceGroupId: string, targetGroupKey: string) => {
    if (!excelPreview) return;
    const source = excelPreview.groups.find((group) => group.id === sourceGroupId);
    const target = excelPreview.groups.find((group) => group.normalizedAddressKey === targetGroupKey);
    if (!source || !target) return;
    const ids = new Set(source.lineIds);
    await updateExcelRows(
      excelPreview.rows.map((row) => ids.has(row.id)
        ? { ...row, normalizedAddress: target.normalizedAddress, manualGroupKey: targetGroupKey }
        : row),
      { targetType: 'group', targetId: sourceGroupId, field: 'manualGroupKey', previous: source.normalizedAddressKey, next: targetGroupKey },
    );
  };

  const useText = () => {
    if (!pastedText.trim()) return setMessage('Pirmiausia įklijuokite tekstą.');
    setDocument({
      ...makeDocument('clipboard', null, 'clipboard.txt', 'text/plain', []),
      pastedText: pastedText.trim(),
    });
    setResult(null);
    setMessage('Tekstas paruoštas analizei.');
  };

  const analyze = async () => {
    if (!document) return setMessage('Pasirinkite dokumentą arba įklijuokite tekstą.');
    setBusy(true);
    setMessage('Atpažįstamas tekstas ir tikrinami adresai…');
    try {
      const provider = document.kind === 'clipboard' || document.kind === 'text'
        ? new MockOcrProvider(document.pastedText)
        : new GoogleVisionOcrProvider();
      const engine = new ImportEngine(
        new ImagePreprocessingPipeline(new ExpoImageTransformAdapter()),
        provider,
        addressResolver,
        new SQLiteImportAuditRepository(db),
      );
      const imported = await engine.import(document);
      setResult(imported);
      applySuggestedPlanningTime(
        imported.deliveries.map((delivery) => {
          const match = delivery.deliveryTime.value?.match(/(\d{1,2}):(\d{2})/);
          return { from: match ? `${match[1]!.padStart(2, '0')}:${match[2]}` : null };
        }),
      );
      setMessage(imported.requiresReview ? 'Patikrinkite ir patvirtinkite pažymėtus adresus.' : 'Dokumentas paruoštas maršrutui.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Dokumento importas nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const persistExcelResult = (nextResult: ImportResult) => {
    if (!excelPreview) return;
    void excelRepository.saveReviewResult(excelPreview.id, nextResult).catch((reason) => {
      if (__DEV__) console.warn('EXCEL_REVIEW_PERSIST_FAILED', reason);
    });
  };

  const updateField = (deliveryId: string, key: EditableField, rawValue: string) => {
    setResult((current) => {
      if (!current) return current;
      const next = {
      ...current,
      deliveries: current.deliveries.map((delivery) => {
        if (delivery.id !== deliveryId) return delivery;
        const value = key === 'weightKg' ? nullableNumber(rawValue) : rawValue.trim() || null;
        return {
          ...delivery,
          [key]: { value, confidence: 1, evidence: 'Vartotojo pataisa', manuallyCorrected: true },
          ...(key === 'address' ? { addressQuery: String(value ?? ''), selectedAddress: null, addressCandidates: [], validationState: 'pending' as const } : {}),
        };
      }),
      };
      persistExcelResult(next);
      if (excelPreview) {
        void excelRepository.recordCorrection({
          id: `correction-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          importSessionId: excelPreview.id,
          targetType: 'group',
          targetId: deliveryId,
          field: key,
          previousValue: current.deliveries.find((item) => item.id === deliveryId)?.[key].value ?? null,
          correctedValue: rawValue.trim() || null,
          createdAt: new Date().toISOString(),
        }).catch((reason) => {
          if (__DEV__) console.warn('EXCEL_CORRECTION_AUDIT_FAILED', reason);
        });
      }
      return next;
    });
  };

  const revalidate = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const deliveries = await resolveDeliveryAddresses(result.deliveries, addressResolver);
      const next = {
        ...result,
        deliveries,
        requiresReview:
          deliveries.some((item) => item.validationState !== 'valid') ||
          result.duplicates.length > 0,
      };
      setResult(next);
      persistExcelResult(next);
      if (excelPreview) {
        setExpandedExcelGroups([]);
        setShowOnlyExcelProblems(true);
        setExcelProblemIndex(0);
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Adresų patikra nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const chooseAddress = (deliveryId: string, candidateIndex: number) => {
    setResult((current) => {
      if (!current) return current;
      const next = {
      ...current,
      deliveries: current.deliveries.map((delivery) => delivery.id === deliveryId
        ? {
            ...delivery,
            selectedAddress: delivery.addressCandidates[candidateIndex] ?? null,
            addressConfidence: delivery.addressCandidates[candidateIndex]?.confidence ?? 0,
            validationState: delivery.addressCandidates[candidateIndex] ? 'valid' as const : 'invalid' as const,
          }
        : delivery),
      };
      persistExcelResult(next);
      return next;
    });
  };

  const sendToRouting = async () => {
    if (!result || creationInFlight.current) return;
    if (!readyForRoute) {
      setMessage(routeCreationBlockers[0] ?? 'Maršruto duomenys dar neparuošti.');
      return;
    }
    creationInFlight.current = true;
    setBusy(true);
    creationCommandId.current ??= `create-route-${result.auditId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const persistAndOpen = async () => {
      const plannedDepartureAt = planningDepartureIso(planningDate, planningTime);
      if (!plannedDepartureAt) throw new Error('Pasirinkite teisingą maršruto datą ir pradžios laiką.');
      if (!warehouseEndpoint) throw new Error('Numatytasis išvykimas nenustatytas. Patikrinkite vietų nustatymus.');
      if (endMode === 'home' && !homeEndpoint) throw new Error('Namų pabaigos vieta nenustatyta. Patikrinkite vietų nustatymus.');
      const startLocation: RouteEndpoint = warehouseEndpoint;
      const endLocation: RouteEndpoint = endMode === 'home' ? homeEndpoint! : warehouseEndpoint;
      await new RouteEndPreference(db).save(endMode);
      await new PlanningModePreference(db).save(planningMode);
      const baseStops = excelPreview
        ? excelPreviewToDraftStops(excelPreview, result.deliveries)
        : importedDeliveriesToDraftStops(result.deliveries);
      // Rows that never made it into any Excel group (unrecognized address text) but
      // the user manually resolved via the "N adreso(-ų) nepavyko atpažinti" warning
      // card — appended as extra stops, offset past the base stops' order numbers.
      const manualStops: DraftStopInput[] = excelPreview
        ? Object.entries(manualRowResolutions).map(([rowId, resolution], index) => {
            const row = excelPreview.rows.find((item) => item.id === rowId);
            return {
              sourceStopId: `excel-manual:${excelPreview.id}:${rowId}`,
              originalOrder: baseStops.length + index + 1,
              orderNumber: row?.orderNumber ?? null,
              recipient: row?.recipient ?? null,
              originalAddress: row?.rawColumnE ?? row?.rawColumnD ?? resolution.address,
              geocodingQuery: resolution.address,
              normalizedAddress: resolution.address,
              addressValidationState: resolution.addressValidationState,
              geocodingError: null,
              latitude: resolution.latitude,
              longitude: resolution.longitude,
              deliveryTimeFrom: row?.deliveryTimeFrom ?? null,
              deliveryTimeTo: row?.deliveryTimeTo ?? null,
              requiredTimeWindow: Boolean(row?.deliveryTimeFrom && row?.deliveryTimeTo),
              weightKg: row?.weightGrams ? row.weightGrams / 1000 : null,
              phone: null,
              notes: null,
            } satisfies DraftStopInput;
          })
        : [];
      const created = await new CreateDraftRouteWithStops(db).execute({
        commandId: creationCommandId.current!,
        date: planningDate,
        plannedDepartureAt,
        planningMode,
        startLocation,
        endLocation,
        sourceImportAuditId: result.auditId,
        importSource: {
          type: excelPreview
            ? 'excel'
            : document?.kind === 'camera' || document?.kind === 'gallery'
            ? 'photo'
            : document?.kind === 'pdf'
              ? 'document'
              : 'pasted_text',
          originalText: excelPreview ? JSON.stringify(excelPreview.summary) : result.ocr.text,
          imageReference: document?.uri ?? null,
        },
        stops: [...baseStops, ...manualStops],
      });
      if (excelPreview) await excelRepository.markRouted(excelPreview.id, created.routeId);
      // Po importo pereinama į trumpą prioritetų peržiūrą. Patvirtinti adresai
      // nebetvirtinami antrą kartą, tačiau vairuotojas gali pažymėti kelis
      // prioritetinius taškus arba iškart skaičiuoti maršrutą.
      router.push({ pathname: '/route/[id]/review', params: { id: created.routeId } });
    };
    try {
      await persistAndOpen();
    } catch (error) {
      if (error instanceof RouteCommandError && error.code === 'ACTIVE_ROUTE_EXISTS') {
        const activeRouteId = error.details.activeRouteId;
        Alert.alert('Jau yra aktyvus maršrutas', error.message, [
          {
            text: 'Tęsti aktyvų',
            onPress: () => { void repository.getById(activeRouteId).then((activeRoute) => {
              if (!activeRoute) return;
              const destination = resolveRoute(activeRoute);
              router.replace({ pathname: destination.pathname, params: destination.params } as Href);
            }).catch((reason) => {
              if (__DEV__) console.warn('ACTIVE_ROUTE_REDIRECT_FAILED', reason);
            }); },
          },
          {
            text: 'Atšaukti aktyvų ir kurti naują',
            style: 'destructive',
            onPress: () => Alert.alert(
              'Patvirtinkite atšaukimą',
              'Aktyvus maršrutas liks audite.',
              [
                { text: 'Ne', style: 'cancel' },
                {
                  text: 'Taip, atšaukti',
                  style: 'destructive',
                  onPress: () => { void (async () => {
                    try {
                      await new CancelDraftRoute(db).execute(activeRouteId);
                      await persistAndOpen();
                    } catch (reason) {
                      Alert.alert('Veiksmas nepavyko', reason instanceof Error ? reason.message : 'Bandykite dar kartą.');
                    }
                  })(); },
                },
              ],
            ),
          },
          { text: 'Grįžti', style: 'cancel' },
        ]);
        return;
      }
      Alert.alert('Maršrutas nesukurtas', error instanceof Error ? error.message : 'Patikrinkite importo duomenis.');
    } finally {
      creationInFlight.current = false;
      setBusy(false);
    }
  };

  const routeCreationBlockers = getRouteCreationBlockers({
    result,
    excelPreview,
    planningMode,
    warehouseEndpoint,
    homeEndpoint,
    endMode,
    manuallyResolvedRowIds: new Set(Object.keys(manualRowResolutions)),
  });
  const readyForRoute = routeCreationBlockers.length === 0;
  const excelDeliveriesById = new Map(result?.deliveries.map((delivery) => [delivery.id, delivery]) ?? []);
  const excelProblemCount = excelPreview?.groups.filter((group) =>
    excelGroupNeedsAction(group, excelDeliveriesById.get(group.id), planningMode),
  ).length ?? 0;
  const excelProblemGroups = excelPreview?.groups.filter((group) =>
    excelGroupNeedsAction(group, excelDeliveriesById.get(group.id), planningMode),
  ) ?? [];
  const selectedProblemIndex = Math.min(excelProblemIndex, Math.max(0, excelProblemGroups.length - 1));
  const visibleExcelGroups = showOnlyExcelProblems
    ? excelProblemGroups.slice(selectedProblemIndex, selectedProblemIndex + 1)
    : (excelPreview?.groups ?? []);
  // Rows that never made it into any group (unrecognized address text) used to
  // vanish with zero indication anywhere in the UI. Surface them explicitly so
  // "the address was in Excel but never became a stop" is always visible.
  const unresolvedExcelRows = excelPreview?.rows.filter((row) => !row.excluded && !row.normalizedAddress) ?? [];

  return (
    <FoundationScreen
      showFoundationNotice={false}
      showHeading={!result}
      title="Importuoti maršrutą"
      description="Pasirinkite Excel, PDF, nuotrauką arba įklijuokite tekstą.">
      <View style={styles.content}>
        {!result ? <>
        <View style={styles.sourceGrid}>
          <SourceButton styles={styles} title="Fotografuoti" onPress={capture} />
          <SourceButton styles={styles} title="Galerija" onPress={pickImages} />
          <SourceButton styles={styles} title="PDF" onPress={pickPdf} />
          <SourceButton styles={styles} title="Excel (.xlsx)" onPress={pickExcel} />
        </View>

        {rememberedExcel && !excelDuplicate ? (
          <View style={styles.card} testID="remembered-excel-card">
            <Text style={styles.cardTitle}>Prisimintas Excel</Text>
            <Text style={styles.helper}>
              {rememberedExcel.preview.fileName} · {rememberedExcel.preview.selectedSheetName} · {rememberedExcel.preview.summary.physicalStopCount} taškų
            </Text>
            <Pressable style={styles.primaryButton} onPress={() => { void restoreRememberedExcel(); }} testID="restore-remembered-excel">
              <Text style={styles.primaryText}>Naudoti prisimintą failą</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setRememberedExcel(null)}>
              <Text style={styles.secondaryText}>Atmesti</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <Pressable style={styles.optionsToggle} onPress={() => setShowPasteField((current) => !current)} testID="toggle-paste-field">
            <Text style={styles.secondaryText}>{showPasteField ? 'Slėpti teksto įklijavimą' : 'Įklijuoti tekstą / OCR (antrinis)'}</Text>
          </Pressable>
          {showPasteField ? (
            <>
              <Text style={styles.cardTitle}>Įklijuoti tekstą</Text>
              <TextInput
                value={pastedText}
                onChangeText={setPastedText}
                multiline
                textAlignVertical="top"
                placeholder={'Vilnius\nGedimino pr. 9\n150 kg\n08:00\n\nKaunas\nSavanorių pr. 1'}
                placeholderTextColor={colors.textMuted}
                style={styles.textArea}
              />
              <Pressable style={styles.secondaryButton} onPress={useText}><Text style={styles.secondaryText}>Naudoti įklijuotą tekstą</Text></Pressable>
            </>
          ) : null}
        </View>

        {document ? <Text style={styles.fileText}>{document.fileName} · {document.pageCount} psl.</Text> : null}
        <Pressable disabled={!document || busy} style={[styles.primaryButton, (!document || busy) && styles.disabled]} onPress={analyze}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Atpažinti dokumentą</Text>}
        </Pressable>
        </> : (
          <Pressable style={styles.changeFileButton} onPress={() => {
            setResult(null);
            setExcelPreview(null);
            setExcelDuplicate(null);
            setExpandedExcelGroups([]);
            setMessage(null);
          }}>
            <Text style={styles.secondaryText}>Pasirinkti kitą failą</Text>
          </Pressable>
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {result && (!excelPreview || excelProblemCount === 0) ? (
          <View style={styles.routeSetupTop} testID="route-setup-top">
            <Text style={styles.cardTitle}>Paruošti maršrutą</Text>
            <View style={styles.compactSummary}>
              <Text style={styles.summaryText}>
                {(excelPreview?.summary.physicalStopCount ?? result.deliveries.length)} taškų · {excelPreview ? formatWeight(excelPreview.summary.totalWeightGrams) : 'svoris pagal taškus'}
              </Text>
              {(excelPreview?.summary.routeCodes.length ?? 0) > 0 ? (
                <Text style={styles.helper}>Regionai: {excelPreview!.summary.routeCodes.join(', ')}</Text>
              ) : null}
            </View>
            <Text style={styles.label}>Pradžia</Text>
            <Text style={styles.endpointText}>{warehouseAddress || 'Savanorių 180, Vilnius'}</Text>
            <Text style={styles.label}>Kada</Text>
            <View style={styles.scheduleRow}>
              <View style={styles.scheduleField}>
                <Text style={styles.fieldCaption}>Data</Text>
                <TextInput
                  value={planningDate}
                  onChangeText={setPlanningDate}
                  style={styles.scheduleInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  {...({ type: 'date' } as object)}
                  testID="planning-date"
                />
              </View>
              <View style={styles.scheduleField}>
                <Text style={styles.fieldCaption}>Starto laikas</Text>
                <TextInput
                  value={planningTime}
                  onChangeText={(value) => {
                    planningTimeTouched.current = true;
                    setPlanningTime(value);
                  }}
                  style={styles.scheduleInput}
                  placeholder="04:00"
                  placeholderTextColor={colors.textMuted}
                  {...({ type: 'time' } as object)}
                  testID="planning-time"
                />
              </View>
            </View>
            {excelPreview && allRouteCodes(excelPreview).length > 1 ? (
              <>
                <Text style={styles.label}>Kryptis</Text>
                <View style={styles.choiceRow}>
                  {allRouteCodes(excelPreview).map((code) => (
                    <Choice
                      styles={styles}
                      key={code}
                      label={code}
                      selected={excelPreview.selectedRouteCodes.includes(code)}
                      onPress={() => { void toggleRouteCode(code); }}
                    />
                  ))}
                </View>
              </>
            ) : null}
            <Text style={styles.label}>Pristatymo laikai</Text>
            <View style={styles.choiceRow}>
              <Choice styles={styles} label="Atsižvelgti" selected={planningMode === 'with_time_windows'} onPress={() => setPlanningMode('with_time_windows')} />
              <Choice styles={styles} label="Neatsižvelgti" selected={planningMode === 'ignore_time_windows'} onPress={() => setPlanningMode('ignore_time_windows')} />
            </View>
            <Text style={styles.label}>Pabaiga</Text>
            <Choice
              styles={styles}
              label={warehouseAddress ? `Grįžti į ${warehouseAddress}` : 'Grįžti į sandėlį'}
              selected={endMode === 'warehouse'}
              disabled={!warehouseEndpoint?.latitude}
              onPress={() => setEndMode('warehouse')}
            />
            <Choice
              styles={styles}
              label={homeAddress ? `Baigti ${homeAddress}` : 'Baigti namuose'}
              selected={endMode === 'home'}
              disabled={!homeEndpoint?.latitude}
              onPress={() => setEndMode('home')}
            />
            {!readyForRoute ? (
              <View style={styles.blockerList} testID="route-creation-blockers">
                {excelPreview && excelProblemCount > 0 ? (
                  <Text style={styles.issueText}>Reikia sutvarkyti {excelProblemCount} pristatymo {excelProblemCount === 1 ? 'tašką' : 'taškus'}.</Text>
                ) : routeCreationBlockers.slice(0, 3).map((blocker) => <Text key={blocker} style={styles.issueText}>• {blocker}</Text>)}
                {(!hasRouteCoordinates(warehouseEndpoint) || (endMode === 'home' && !hasRouteCoordinates(homeEndpoint))) ? (
                  <Pressable style={styles.secondaryButton} onPress={() => router.push('/settings/locations' as Href)}>
                    <Text style={styles.secondaryText}>Atidaryti vietų nustatymus</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <Pressable
              disabled={!readyForRoute || busy}
              style={[styles.primaryButton, (!readyForRoute || busy) && styles.disabled]}
              onPress={sendToRouting}
              testID="create-route-top">
              <Text style={styles.primaryText}>Kurti maršrutą</Text>
            </Pressable>
          </View>
        ) : null}

        {excelDuplicate ? (
          <View style={styles.warningCard}>
            <Text style={styles.cardTitle}>Pakartotinis Excel failas</Text>
            <Text style={styles.helper}>Tas pats failo hash ir lapas jau yra importo audite.</Text>
            <Pressable style={styles.secondaryButton} onPress={reopenDuplicateExcel}><Text style={styles.secondaryText}>Atkurti ankstesnę peržiūrą</Text></Pressable>
            <Pressable style={styles.secondaryButton} onPress={importDuplicateAsNewDay}><Text style={styles.secondaryText}>Naudoti naujai darbo dienai</Text></Pressable>
          </View>
        ) : null}

        {excelPreview ? (
          <>
            <View style={styles.compactSummary}>
              <Text style={styles.summaryText}>{excelPreview.summary.physicalStopCount} taškų · {formatWeight(excelPreview.summary.totalWeightGrams)}</Text>
              <Text style={excelProblemCount > 0 ? styles.issueText : styles.successText}>
                {excelProblemCount > 0 ? `Patikrinkite ${excelProblemCount} ${excelProblemCount === 1 ? 'adresą' : 'adresus'}` : 'Paruošta planuoti'}
              </Text>
              <Pressable style={styles.optionsToggle} onPress={() => setShowExcelOptions((current) => !current)}>
                <Text style={styles.secondaryText}>{showExcelOptions ? 'Slėpti pasirinkimus' : 'Keisti lapą ar kryptį'}</Text>
              </Pressable>
              {showExcelOptions ? <View style={styles.optionsPanel}>
                <Text style={styles.label}>Excel lapas</Text>
                <View style={styles.choiceRow}>
                  {excelPreview.sheets.map((sheet) => (
                    <Choice styles={styles} key={sheet.name} label={sheet.name} selected={sheet.name === excelPreview.selectedSheetName} onPress={() => { void reparseExcel(sheet.name); }} />
                  ))}
                </View>
              </View> : null}
            </View>

            {unresolvedExcelRows.length > 0 ? (
              <View style={styles.warningCard} testID="excel-unresolved-rows">
                <Text style={styles.cardTitle}>⚠️ {unresolvedExcelRows.length} adreso(-ų) nepavyko atpažinti</Text>
                <Text style={styles.helper}>
                  Šios Excel eilutės NEPATEKO į maršrutą, nes adresas jose nebuvo atpažintas. Pataisykite adresą žemiau ir bandykite dar kartą, arba pridėkite tašką rankiniu būdu.
                </Text>
                {unresolvedExcelRows.map((row) => (
                  <UnresolvedRowFixer
                    key={row.id}
                    row={row}
                    styles={styles}
                    colors={colors}
                    resolver={addressResolver}
                    resolution={manualRowResolutions[row.id]}
                    onResolved={(rowId, resolution) => {
                      setManualRowResolutions((current) => {
                        if (!resolution) {
                          const { [rowId]: _removed, ...rest } = current;
                          return rest;
                        }
                        return { ...current, [rowId]: resolution };
                      });
                    }}
                  />
                ))}
              </View>
            ) : null}

            {!excelPreview.mappingRecognized ? (
              <View style={styles.warningCard}>
                <Text style={styles.cardTitle}>Susiekite stulpelius</Text>
                <Text style={styles.helper}>Struktūra neatpažinta patikimai, todėl automatinis importas sustabdytas.</Text>
                {(Object.keys(columnMapping) as Array<keyof ExcelColumnMapping>).map((key) => (
                  <View key={key} style={styles.fieldGroup}>
                    <Text style={styles.label}>{mappingLabel(key)}</Text>
                    <TextInput
                      value={columnMapping[key] ?? ''}
                      onChangeText={(value) => setColumnMapping((current) => ({ ...current, [key]: value.trim().toUpperCase() || null }))}
                      autoCapitalize="characters"
                      style={styles.input}
                      placeholder="Pvz. A"
                    />
                  </View>
                ))}
                <Pressable style={styles.secondaryButton} onPress={() => { void reparseExcel(undefined, true); }}><Text style={styles.secondaryText}>Taikyti susiejimą</Text></Pressable>
              </View>
            ) : null}

            {(excelProblemCount > 0 || !showOnlyExcelProblems) ? <Pressable
              testID="excel-problems-filter"
              style={styles.secondaryButton}
              onPress={() => {
                setShowOnlyExcelProblems((current) => !current);
                setExpandedExcelGroups([]);
                setExcelProblemIndex(0);
              }}>
              <Text style={styles.secondaryText}>
                {showOnlyExcelProblems ? `Peržiūrėti visus taškus (${excelPreview.groups.length})` : `Grįžti prie taisytinų (${excelProblemCount})`}
              </Text>
            </Pressable> : null}

            {showOnlyExcelProblems && excelProblemCount > 0 ? (
              <View style={styles.problemNavigator} testID="excel-problem-navigator">
                <Pressable
                  disabled={selectedProblemIndex === 0}
                  style={[styles.navigatorButton, selectedProblemIndex === 0 && styles.disabled]}
                  onPress={() => { setExpandedExcelGroups([]); setExcelProblemIndex((current) => Math.max(0, current - 1)); }}>
                  <Text style={styles.secondaryText}>← Ankstesnis</Text>
                </Pressable>
                <Text style={styles.problemCounter}>{selectedProblemIndex + 1} iš {excelProblemCount}</Text>
                <Pressable
                  disabled={selectedProblemIndex >= excelProblemCount - 1}
                  style={[styles.navigatorButton, selectedProblemIndex >= excelProblemCount - 1 && styles.disabled]}
                  onPress={() => { setExpandedExcelGroups([]); setExcelProblemIndex((current) => Math.min(excelProblemCount - 1, current + 1)); }}>
                  <Text style={styles.secondaryText}>Kitas →</Text>
                </Pressable>
              </View>
            ) : null}

            {visibleExcelGroups.map((group) => {
              const expanded = expandedExcelGroups.includes(group.id);
              const rows = group.lineIds.map((id) => excelPreview.rows.find((row) => row.id === id)).filter(Boolean) as ExcelImportPreview['rows'];
              const delivery = excelDeliveriesById.get(group.id);
              const needsAction = excelGroupNeedsAction(group, delivery, planningMode);
              return (
                <View key={group.id} style={[styles.excelCompactCard, needsAction && styles.excelProblemCard]} testID={`excel-group-${group.id}`}>
                  <Text style={styles.cardTitle}>{group.normalizedAddress}</Text>
                  <Text style={styles.compactMeta}>{formatWeight(group.totalWeightGrams)} · {formatGroupTime(rows)}</Text>
                  {needsAction ? <Text style={styles.issueText}>{excelProblemText(group, delivery)}</Text> : null}
                  <Pressable style={styles.compactButton} onPress={() => setExpandedExcelGroups((current) => expanded ? current.filter((id) => id !== group.id) : [...current, group.id])}>
                    <Text style={styles.secondaryText}>{expanded ? 'Uždaryti taisymą' : needsAction ? 'Taisyti šį adresą' : 'Peržiūrėti'}</Text>
                  </Pressable>
                  {expanded && delivery ? (
                    <DeliveryEditor styles={styles} colors={colors} delivery={delivery} index={excelPreview.groups.indexOf(group)} onChange={updateField} onChooseAddress={chooseAddress} compact />
                  ) : null}
                  {expanded && showExcelOptions ? rows.map((row) => (
                    <View key={row.id} style={[styles.excelRow, row.excluded && styles.excludedRow]}>
                      <Text style={styles.label}>Excel eilutė {row.sourceRowNumber} · {formatOptionalWeight(row.weightGrams)}</Text>
                      <Text style={styles.helper}>{row.recipient ?? 'Gavėjas nenurodytas'} · {row.deliveryTimeRaw ?? 'laikas nenurodytas'}</Text>
                      <View style={styles.choiceRow}>
                        <Pressable style={styles.miniButton} onPress={() => { void toggleExcelRow(row.id); }}><Text style={styles.secondaryText}>{row.excluded ? 'Įtraukti' : 'Pašalinti'}</Text></Pressable>
                        <Pressable style={styles.miniButton} onPress={() => { void splitExcelRow(row.id); }}><Text style={styles.secondaryText}>Atskirti</Text></Pressable>
                        <Pressable style={styles.miniButton} onPress={() => setMovingExcelLineId(row.id)}><Text style={styles.secondaryText}>Perkelti</Text></Pressable>
                      </View>
                      {movingExcelLineId === row.id ? (
                        <View style={styles.moveTargets}>
                          <Text style={styles.label}>Perkelti į:</Text>
                          {excelPreview.groups.filter((item) => item.id !== group.id).map((target) => (
                            <Pressable key={target.id} style={styles.candidateButton} onPress={() => { void moveExcelRow(row.id, target.normalizedAddressKey); }}>
                              <Text style={styles.candidateText}>{target.normalizedAddress}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  )) : null}
                  {expanded && showExcelOptions && excelPreview.groups.length > 1 ? (
                    <View style={styles.moveTargets}>
                      <Text style={styles.label}>Sujungti visą sustojimą su:</Text>
                      {excelPreview.groups.filter((item) => item.id !== group.id).map((target) => (
                        <Pressable key={target.id} style={styles.candidateButton} onPress={() => { void mergeExcelGroups(group.id, target.normalizedAddressKey); }}>
                          <Text style={styles.candidateText}>{target.normalizedAddress}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </>
        ) : null}

        {result ? (
          <>
            {!excelPreview ? <View style={styles.qualityCard}>
              <Text style={styles.cardTitle}>Importo kokybė {percent(result.quality.overallConfidence)}</Text>
              <Text style={styles.helper}>OCR {percent(result.quality.ocrConfidence)} · Parseris {percent(result.quality.parserConfidence)} · Adresai {percent(result.quality.addressConfidence)}</Text>
            </View> : null}
            {!excelPreview ? result.deliveries.map((delivery, index) => (
              <DeliveryEditor
                styles={styles}
                colors={colors}
                key={delivery.id}
                delivery={delivery}
                index={index}
                onChange={updateField}
                onChooseAddress={chooseAddress}
              />
            )) : null}
            {!excelPreview && result.duplicates.length ? (
              <View style={styles.warningCard}><Text style={styles.cardTitle}>Galimi dublikatai: {result.duplicates.length}</Text><Text style={styles.helper}>Patikrinkite pasikartojančius užsakymus ar panašius adresus.</Text></View>
            ) : null}
            {(!excelPreview || excelProblemCount > 0) ? <Pressable style={styles.primaryButton} onPress={revalidate} disabled={busy} testID="revalidate-visible-address">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{excelPreview && showOnlyExcelProblems ? 'Patikrinti šį adresą' : 'Patikrinti pataisytus adresus'}</Text>}
            </Pressable> : null}
          </>
        ) : null}
      </View>
    </FoundationScreen>
  );
}

type EditableField = 'address' | 'orderNumber' | 'weightKg' | 'deliveryTime' | 'phone' | 'recipient' | 'notes';

function DeliveryEditor(props: {
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  delivery: ParsedDelivery;
  index: number;
  onChange: (id: string, field: EditableField, value: string) => void;
  onChooseAddress: (id: string, index: number) => void;
  compact?: boolean;
}) {
  const { styles, colors } = props;
  const [expandedOptionalFields, setExpandedOptionalFields] = useState<EditableField[]>([]);
  const [showCompactDetails, setShowCompactDetails] = useState(false);
  const fields: Array<{ key: EditableField; label: string; field: ImportField<string | number> }> = [
    { key: 'address', label: 'Adresas', field: props.delivery.address },
    { key: 'weightKg', label: 'Svoris, kg', field: props.delivery.weightKg },
    { key: 'deliveryTime', label: 'Pristatymo laikas', field: props.delivery.deliveryTime },
    { key: 'recipient', label: 'Gavėjas', field: props.delivery.recipient },
    { key: 'notes', label: 'Pastabos', field: props.delivery.notes },
  ];
  const visibleFields = props.compact && !showCompactDetails
    ? fields.filter((field) => field.key === 'address')
    : fields;
  return (
    <View style={props.compact ? styles.compactEditor : styles.card} testID={`delivery-editor-${props.delivery.id}`}>
      {!props.compact ? <Text style={styles.cardTitle}>Pristatymas {props.index + 1}</Text> : null}
      {visibleFields.map(({ key, label, field }) => {
        const required = key === 'address';
        const missing = field.value === null;
        const addressInvalid = required && props.delivery.validationState !== 'valid';
        const expanded = expandedOptionalFields.includes(key);
        if (!required && missing && !expanded) {
          return (
            <Pressable
              accessibilityRole="button"
              key={key}
              onPress={() => setExpandedOptionalFields((current) => [...current, key])}
              style={styles.optionalEmptyRow}>
              <Text style={styles.optionalLabel}>{label}</Text>
              <Text style={styles.optionalValue}>Nenurodyta · neprivaloma</Text>
            </Pressable>
          );
        }
        const level = addressInvalid ? 'danger' : confidenceLevel(field.confidence);
        const confidence = required && props.delivery.validationState === 'valid'
          ? props.delivery.addressConfidence
          : field.confidence;
        return (
          <View key={key} style={styles.fieldGroup}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{label}{required ? ' *' : ''}</Text>
              {addressInvalid ? (
                <Text style={[styles.confidence, styles.danger]}>
                  {field.value ? 'Nepatvirtintas' : 'Privalomas'}
                </Text>
              ) : field.value !== null ? (
                <Text style={[styles.confidence, styles[level]]}>{percent(confidence)}</Text>
              ) : (
                <Text style={styles.optionalValue}>Neprivaloma</Text>
              )}
            </View>
            <TextInput
              testID={`delivery-field-${props.delivery.id}-${key}`}
              value={field.value === null ? '' : String(field.value)}
              onChangeText={(value) => props.onChange(props.delivery.id, key, value)}
              style={[
                styles.input,
                field.value === null && !required
                  ? styles.neutralBorder
                  : styles[`${level}Border`],
              ]}
              placeholder={required ? 'Įveskite ir patvirtinkite adresą' : 'Neprivaloma'}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        );
      })}
      {props.compact ? (
        <Pressable
          accessibilityRole="button"
          style={styles.compactButton}
          onPress={() => setShowCompactDetails((current) => !current)}>
          <Text style={styles.secondaryText}>
            {showCompactDetails ? 'Slėpti papildomus laukus' : 'Rodyti svorį, laiką ir gavėją'}
          </Text>
        </Pressable>
      ) : null}
      {props.delivery.addressCandidates.length > 1 ? (
        <View style={styles.candidates}>
          <Text style={styles.label}>Pasirinkite adresą</Text>
          {props.delivery.addressCandidates.map((candidate, index) => (
            <Pressable key={`${candidate.placeId}-${index}`} style={styles.candidateButton} onPress={() => props.onChooseAddress(props.delivery.id, index)}>
              <Text style={styles.candidateText}>{candidate.normalizedAddress}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SourceButton({ styles, title, onPress }: { styles: ReturnType<typeof createStyles>; title: string; onPress: () => void }) {
  return <Pressable style={styles.sourceButton} onPress={onPress}><Text style={styles.secondaryText}>{title}</Text></Pressable>;
}

function UnresolvedRowFixer({
  row,
  styles,
  colors,
  resolver,
  resolution,
  onResolved,
}: {
  row: ExcelSourceRow;
  styles: ReturnType<typeof createStyles>;
  colors: ColorPalette;
  resolver: GatewayAddressResolver;
  resolution: ManualRowResolution | undefined;
  onResolved: (rowId: string, resolution: ManualRowResolution | null) => void;
}) {
  const [address, setAddress] = useState(row.rawColumnE ?? row.rawColumnD ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

  if (resolution) {
    return (
      <View style={styles.excelRow}>
        <Text style={styles.label}>Eilutė {row.sourceRowNumber} · ✓ pridėta</Text>
        <Text style={styles.high}>
          {resolution.address}
          {resolution.latitude === null ? ' (be koordinačių — patvirtinkite planavimo ekrane)' : ''}
        </Text>
        <Pressable style={styles.compactButton} onPress={() => onResolved(row.id, null)}>
          <Text style={styles.linkText}>Taisyti iš naujo</Text>
        </Pressable>
      </View>
    );
  }

  const retryGeocode = async () => {
    if (!address.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const candidates = await resolver.resolve(address.trim());
      const best = candidates[0];
      if (!best) {
        setError('Adreso rasti nepavyko. Įveskite koordinates rankiniu būdu arba pridėkite be geokodavimo.');
        return;
      }
      if (candidates.length === 1) {
        onResolved(row.id, {
          address: best.normalizedAddress,
          latitude: best.latitude,
          longitude: best.longitude,
          addressValidationState: 'auto_confirmed',
        });
      } else {
        onResolved(row.id, {
          address: best.normalizedAddress,
          latitude: best.latitude,
          longitude: best.longitude,
          addressValidationState: 'unconfirmed',
        });
        setError('Adresas neaiškus (keli variantai) — patikrinkite jį planavimo ekrane prieš skaičiuojant maršrutą.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Geokodavimas nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const applyManualCoords = () => {
    const lat = Number(manualLat.trim().replace(',', '.'));
    const lng = Number(manualLng.trim().replace(',', '.'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setError('Neteisingos koordinatės. Formatas: platuma (pvz. 55.7418), ilguma (pvz. 24.3618).');
      return;
    }
    onResolved(row.id, {
      address: address.trim() || (row.rawColumnE ?? row.rawColumnD ?? 'Adresas'),
      latitude: lat,
      longitude: lng,
      addressValidationState: 'auto_confirmed',
    });
    setError(null);
  };

  const addWithoutGeocoding = () => {
    if (!address.trim()) {
      setError('Įveskite adresą.');
      return;
    }
    onResolved(row.id, {
      address: address.trim(),
      latitude: null,
      longitude: null,
      addressValidationState: 'unconfirmed',
    });
    setError(null);
  };

  return (
    <View style={styles.excelRow}>
      <Text style={styles.label}>Eilutė {row.sourceRowNumber}</Text>
      <TextInput
        value={address}
        onChangeText={setAddress}
        style={styles.input}
        placeholder="Pataisytas adresas"
        placeholderTextColor={colors.textMuted}
      />
      <Pressable disabled={busy || !address.trim()} style={[styles.secondaryButton, (busy || !address.trim()) && styles.disabled]} onPress={() => { void retryGeocode(); }}>
        {busy ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Bandyti geokoduoti iš naujo</Text>}
      </Pressable>
      {error ? <Text style={styles.danger}>{error}</Text> : null}
      <Pressable style={styles.compactButton} onPress={() => setShowManualCoords((value) => !value)}>
        <Text style={styles.linkText}>{showManualCoords ? 'Slėpti koordinačių įvedimą' : 'Įvesti koordinates rankiniu būdu'}</Text>
      </Pressable>
      {showManualCoords ? (
        <View style={styles.fieldGroup}>
          <TextInput value={manualLat} onChangeText={setManualLat} keyboardType="decimal-pad" placeholder="Platuma, pvz. 55.7418" placeholderTextColor={colors.textMuted} style={styles.input} />
          <TextInput value={manualLng} onChangeText={setManualLng} keyboardType="decimal-pad" placeholder="Ilguma, pvz. 24.3618" placeholderTextColor={colors.textMuted} style={styles.input} />
          <Pressable style={styles.secondaryButton} onPress={applyManualCoords}><Text style={styles.secondaryText}>Naudoti šias koordinates</Text></Pressable>
        </View>
      ) : null}
      <Pressable style={styles.compactButton} onPress={addWithoutGeocoding}>
        <Text style={styles.linkText}>Pridėti tašką be geokodavimo</Text>
      </Pressable>
    </View>
  );
}

function Choice(props: { styles: ReturnType<typeof createStyles>; label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { styles } = props;
  return <Pressable disabled={props.disabled} style={[styles.choice, props.selected && styles.choiceSelected, props.disabled && styles.disabled]} onPress={props.onPress}><Text style={props.selected ? styles.choiceTextSelected : styles.choiceText}>{props.label}</Text></Pressable>;
}

function makeDocument(
  kind: ImportDocument['kind'],
  uri: string | null,
  fileName: string,
  mimeType: string,
  pageUris: string[],
  sizeBytes: number | null = null,
): ImportDocument {
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    uri,
    pageUris,
    fileName,
    mimeType,
    sizeBytes,
    pageCount: Math.max(1, pageUris.length),
    createdAt: new Date().toISOString(),
  };
}

function nullableNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatWeight(grams: number): string {
  return `${new Intl.NumberFormat('lt-LT', { maximumFractionDigits: 0 }).format(Math.round(grams / 1000))} kg`;
}

function formatOptionalWeight(grams: number | null): string {
  return grams === null ? 'svoris nežinomas' : formatWeight(grams);
}

function formatGroupTime(rows: ExcelImportPreview['rows']): string {
  const times = [...new Set(rows.map((row) => row.deliveryTimeRaw).filter((value): value is string => Boolean(value)))];
  return times.length === 0 ? 'be laiko' : times.length === 1 ? times[0] : 'keli laikai';
}

function excelGroupNeedsAction(
  group: ExcelImportPreview['groups'][number],
  delivery: ParsedDelivery | undefined,
  planningMode: PlanningMode,
): boolean {
  const blockingIssueCodes = new Set([
    'ADDRESS_MISSING',
    'ADDRESS_SOURCE_CONFLICT',
    'INVALID_WEIGHT',
    'NEGATIVE_WEIGHT',
    'COLUMN_MAPPING_REQUIRED',
  ]);
  return group.issueCodes.some((code) => blockingIssueCodes.has(code))
    || (planningMode === 'with_time_windows' && (
      group.issueCodes.includes('TIME_WINDOW_CONFLICT') ||
      group.issueCodes.includes('INVALID_TIME_WINDOW')
    ))
    || !delivery?.selectedAddress
    || delivery.validationState !== 'valid';
}

function excelProblemText(group: ExcelImportPreview['groups'][number], delivery?: ParsedDelivery): string {
  if (delivery?.validationState === 'ambiguous') return 'Adresas turi kelis galimus variantus.';
  if (delivery?.validationState === 'invalid' || group.issueCodes.includes('ADDRESS_MISSING')) return 'Adreso patvirtinti nepavyko.';
  if (group.issueCodes.includes('ADDRESS_SOURCE_CONFLICT')) return 'Excel adreso šaltiniai nesutampa.';
  if (group.issueCodes.includes('TIME_WINDOW_CONFLICT')) return 'Skiriasi šio sustojimo pristatymo laikai.';
  if (group.issueCodes.includes('INVALID_TIME_WINDOW')) return 'Pristatymo laiko formatas neatpažintas.';
  if (group.issueCodes.includes('INVALID_WEIGHT') || group.issueCodes.includes('NEGATIVE_WEIGHT')) return 'Svorio reikšmę reikia patikrinti.';
  return 'Reikia patikrinti šio sustojimo duomenis.';
}

function allRouteCodes(preview: ExcelImportPreview): string[] {
  return [...new Set(preview.rows.map((row) => row.routeCode).filter((value): value is string => Boolean(value)))].sort();
}

function mappingLabel(key: keyof ExcelColumnMapping): string {
  const labels: Record<keyof ExcelColumnMapping, string> = {
    orderNumber: 'Užsakymo numeris',
    weightKg: 'Svoris',
    deliveryTime: 'Pristatymo laikas',
    companyOrSupplier: 'Įmonė / tiekėjas',
    deliveryAddress: 'Pristatymo adresas',
    recipient: 'Gavėjas',
    routeCode: 'Maršruto kodas',
  };
  return labels[key];
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.md },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sourceButton: { flexGrow: 1, minWidth: '30%', minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  card: { padding: spacing.md, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  routeSetupTop: { padding: spacing.md, borderRadius: 18, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface, gap: spacing.sm, shadowColor: '#183525', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 3 },
  scheduleRow: { flexDirection: 'row', gap: spacing.sm },
  scheduleField: { flex: 1, minWidth: 0, gap: 4 },
  fieldCaption: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  scheduleInput: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, color: colors.text, backgroundColor: colors.background, fontSize: 16, fontWeight: '700' },
  compactSummary: { paddingHorizontal: spacing.xs, gap: 2 },
  excelCompactCard: { padding: spacing.sm, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  excelProblemCard: { borderColor: '#D92D20', backgroundColor: colors.surface },
  compactMeta: { color: colors.textMuted, fontSize: 14, lineHeight: 19 },
  compactButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.xs },
  compactEditor: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  endpointText: { color: colors.text, fontWeight: '700', lineHeight: 21, paddingVertical: spacing.xs },
  confirmedEndpoint: { color: colors.primary, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  changeFileButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.sm },
  successText: { color: '#13795B', fontWeight: '800', lineHeight: 20 },
  optionsToggle: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  optionsPanel: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  problemNavigator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navigatorButton: { minHeight: 44, minWidth: 104, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  problemCounter: { color: colors.text, fontWeight: '800', textAlign: 'center' },
  qualityCard: { padding: spacing.md, borderRadius: 14, backgroundColor: colors.primarySoft },
  warningCard: { padding: spacing.md, borderRadius: 14, borderWidth: 1, borderColor: '#D69E2E', backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  summaryText: { color: colors.text, fontSize: 16, fontWeight: '800', lineHeight: 23 },
  issueText: { color: '#B42318', fontWeight: '700', lineHeight: 20 },
  blockerList: { gap: spacing.xs },
  excelRow: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  excludedRow: { opacity: 0.48 },
  rawText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  miniButton: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  moveTargets: { gap: spacing.sm, paddingTop: spacing.sm },
  textArea: { minHeight: 150, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.text, backgroundColor: colors.background },
  primaryButton: { minHeight: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  fileText: { color: colors.text, fontWeight: '700' },
  message: { color: colors.textMuted, lineHeight: 20 },
  helper: { color: colors.textMuted, lineHeight: 20, marginTop: spacing.xs },
  fieldGroup: { gap: 5 },
  optionalEmptyRow: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  optionalLabel: { color: colors.text, fontWeight: '700', flexShrink: 1 },
  optionalValue: { color: colors.textMuted, fontSize: 13, textAlign: 'right' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: colors.text, fontWeight: '700' },
  confidence: { fontWeight: '800' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 2, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.background },
  linkText: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  high: { color: '#13795B' },
  warning: { color: '#A15C00' },
  danger: { color: '#B42318' },
  highBorder: { borderColor: '#A7D7C5' },
  warningBorder: { borderColor: '#E9B949', backgroundColor: colors.surface },
  dangerBorder: { borderColor: '#D92D20', backgroundColor: colors.surface },
  neutralBorder: { borderColor: colors.border, backgroundColor: colors.background },
  candidates: { gap: spacing.sm, marginTop: spacing.sm },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { color: colors.text, fontWeight: '700' },
  choiceTextSelected: { color: '#fff', fontWeight: '800' },
  candidateButton: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, padding: spacing.sm, justifyContent: 'center' },
  candidateText: { color: colors.primary, fontWeight: '700' },
});
