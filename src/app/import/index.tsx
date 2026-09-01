import { useLocalAccess } from '@/application/auth/local-access-context';
import { roleHomePath } from '@/application/navigation/role-home';
import { useRouteCloudSync } from '@/application/sync/route-cloud-sync-context';
import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { resolveDeliveryAddresses, type AddressLookupProvider } from '@/application/import/address-resolver';
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
import { getRouteCreationBlockers, hasRouteCoordinates } from '@/application/import/route-creation-readiness';
import { defaultPlanningDate, defaultPlanningTime, planningDepartureIso } from '@/application/routes/planning-schedule';
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
import { GetDefaultLocations, KRETINGA_WAREHOUSE_ADDRESS, PlanningModePreference, SaveDefaultLocation } from '@/application/routes/saved-locations';
import { CameraIcon, ChevronDownIcon, ChevronRightIcon, ClipboardIcon, ExcelIcon, GalleryIcon, PdfIcon, PencilIcon, RegionIcon, WindowIcon } from '@/components/app-icons';
import { DateInput } from '@/components/date-input';
import { FoundationScreen } from '@/components/foundation-screen';
import { ExcelImportRepository, type ExcelSheetSession } from '@/database/repositories/excel-import-repository';
import { AddressResolutionMemoryRepository } from '@/database/repositories/address-resolution-memory-repository';
import { RouteRepository } from '@/database/repositories/route-repository';
import { confidenceLevel } from '@/domain/import/confidence';
import {
    LOGISTICS_EXCEL_V1,
    type ExcelColumnMapping,
    type ExcelImportPreview,
    type ExcelSourceRow,
} from '@/domain/import/excel-models';
import type { ImportDocument, ImportField, ImportResult, ParsedDelivery } from '@/domain/import/models';
import { smelynes25UnloadLabel } from '@/domain/import/smelynes-25-unloads';
import type { PlanningMode, RouteEndpoint } from '@/domain/route';
import { readPickedExcelAsset } from '@/infrastructure/import/excel-file-adapter';
import { ExpoImageTransformAdapter } from '@/infrastructure/import/expo-image-transform-adapter';
import { GatewayAddressResolver } from '@/infrastructure/import/gateway-address-resolver';
import { RememberingAddressResolver } from '@/infrastructure/import/remembering-address-resolver';
import { GoogleVisionOcrProvider } from '@/infrastructure/import/ocr/google-vision-ocr-provider';
import { MockOcrProvider } from '@/infrastructure/import/ocr/mock-ocr-provider';
import { SQLiteImportAuditRepository } from '@/infrastructure/import/sqlite-import-audit-repository';
import { Alert } from '@/ui/alert';
import { devWarn } from '@/ui/dev-log';
import { useTheme } from '@/ui/theme';
import type { ColorPalette } from '@/ui/theme-palette';
import { radius, spacing, type } from '@/ui/tokens';

type ManualRowResolution = {
  address: string;
  latitude: number | null;
  longitude: number | null;
  addressValidationState: 'auto_confirmed' | 'unconfirmed';
};

export default function ImportScreen() {
  const { profile } = useLocalAccess();
  const { requestSync } = useRouteCloudSync();
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const repository = useMemo(() => new RouteRepository(db), [db]);
  const excelRepository = useMemo(() => new ExcelImportRepository(db), [db]);
  const addressMemory = useMemo(() => new AddressResolutionMemoryRepository(db), [db]);
  const [pastedText, setPastedText] = useState('');
  const [document, setDocument] = useState<ImportDocument | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [excelPreview, setExcelPreview] = useState<ExcelImportPreview | null>(null);
  const [excelDuplicate, setExcelDuplicate] = useState<ExcelImportPreview | null>(null);
  const [expandedExcelGroups, setExpandedExcelGroups] = useState<string[]>([]);
  const [showOnlyExcelProblems, setShowOnlyExcelProblems] = useState(true);
  const [excelProblemIndex, setExcelProblemIndex] = useState(0);
  const [showExcelOptions, setShowExcelOptions] = useState(false);
  const [showExcelContent, setShowExcelContent] = useState(false);
  const [showPhotoSources, setShowPhotoSources] = useState(false);
  const [showPasteField, setShowPasteField] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [rememberedExcel, setRememberedExcel] = useState<{
    preview: ExcelImportPreview;
    result: ImportResult | null;
  } | null>(null);
  const [excelSheetBatch, setExcelSheetBatch] = useState<ExcelSheetSession[]>([]);
  const [excelBatchHashes, setExcelBatchHashes] = useState<string[]>([]);
  const [movingExcelLineId, setMovingExcelLineId] = useState<string | null>(null);
  const [columnMapping, setColumnMapping] = useState<ExcelColumnMapping>(LOGISTICS_EXCEL_V1.columns);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const endMode = 'warehouse' as const;
  const [startMode, setStartMode] = useState<'warehouse' | 'kretinga' | null>(null);

  useEffect(() => {
    if (profile.role === 'driver' && !profile.permissions?.canCreateRoutes) router.replace(roleHomePath(profile.role) as Href);
  }, [profile, router]);
  const [planningMode, setPlanningMode] = useState<PlanningMode>('ignore_time_windows');
  const [planningDate, setPlanningDate] = useState(() => defaultPlanningDate());
  const [planningTime, setPlanningTime] = useState(() => defaultPlanningTime());
  const planningTimeTouched = useRef(false);
  const [warehouseEndpoint, setWarehouseEndpoint] = useState<RouteEndpoint | null>(null);
  const [kretingaEndpoint, setKretingaEndpoint] = useState<RouteEndpoint | null>(null);
  const addressResolver = useMemo(
    () => new RememberingAddressResolver(new GatewayAddressResolver(), addressMemory),
    [addressMemory],
  );
  const [manualRowResolutions, setManualRowResolutions] = useState<Record<string, ManualRowResolution>>({});
  const creationInFlight = useRef(false);
  const creationCommandId = useRef<string | null>(null);
  const excelBytes = useRef<Uint8Array | null>(null);
  const excelAsset = useRef<{ name: string; hash: string } | null>(null);
  const excelBatchAssets = useRef(new Map<string, { name: string; bytes: Uint8Array }>());
  const selectedStartEndpoint = startMode === 'kretinga' ? kretingaEndpoint : startMode === 'warehouse' ? warehouseEndpoint : null;

  useEffect(() => {
    creationCommandId.current = null;
  }, [result?.auditId]);

  useEffect(() => {
    let active = true;
    // Restore the whole workbook batch after returning from route planning so
    // the next sheet is selectable without uploading the file again.
    void excelRepository.getActiveBatchFileHashes().then(async (fileHashes) => {
      if (!active || result || document || excelPreview) return;
      if (fileHashes.length > 0) {
        const sessions = await excelRepository.listSheetSessions(fileHashes);
        if (!active) return;
        if (sessions.length > 0) {
          setExcelBatchHashes(fileHashes);
          setExcelSheetBatch(sessions);
          setRememberedExcel(null);
          return;
        }
        await excelRepository.saveActiveBatchFileHashes([]);
      }
      const restored = await excelRepository.getLatestReview();
      if (!active || !restored) return;
      setRememberedExcel(restored);
    }).catch((reason) => {
      devWarn('EXCEL_IMPORT_REMEMBER_FAILED', reason);
    });
    return () => { active = false; };
  }, [document, excelPreview, excelRepository, result]);

  useFocusEffect(useCallback(() => {
    let active = true;
    void new GetDefaultLocations(db).execute().then(async ({ warehouse }) => {
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
      const recoveredWarehouse = await recover(warehouse, 'warehouse');
      if (!active) return null;
      setWarehouseEndpoint(recoveredWarehouse);
      // Default to the saved warehouse so dispatchers don't have to pick it
      // on every route — Kretinga stays an explicit opt-in.
      setStartMode((current) => current ?? (recoveredWarehouse?.latitude ? 'warehouse' : current));
      return null;
    }).catch((reason) => {
      devWarn('DEFAULT_LOCATIONS_LOAD_FAILED', reason);
      if (active) setMessage('Išsaugotų vietų atkurti nepavyko. Galite įvesti vietą ranka.');
    });
    return () => { active = false; };
  }, [addressResolver, db]));

  useFocusEffect(useCallback(() => {
    let active = true;
    if (excelBatchHashes.length > 0) {
      void excelRepository.listSheetSessions(excelBatchHashes).then((sessions) => {
        if (active) setExcelSheetBatch(sessions);
      }).catch((reason) => {
        devWarn('EXCEL_BATCH_REFRESH_FAILED', reason);
      });
    }
    return () => { active = false; };
  }, [excelBatchHashes, excelRepository]));

  useEffect(() => {
    void new PlanningModePreference(db).get()
      .then(setPlanningMode)
      .catch((reason) => {
        devWarn('PLANNING_MODE_PREFERENCE_LOAD_FAILED', reason);
      });
  }, [db]);

  useEffect(() => {
    let active = true;
    void addressResolver.resolve(KRETINGA_WAREHOUSE_ADDRESS).then((candidates) => {
      if (!active || candidates.length === 0) return;
      const candidate = candidates[0];
      setKretingaEndpoint({
        originalAddress: KRETINGA_WAREHOUSE_ADDRESS,
        geocodingQuery: KRETINGA_WAREHOUSE_ADDRESS,
        normalizedAddress: candidate.normalizedAddress,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      });
    }).catch((reason) => {
      devWarn('KRETINGA_START_GEOCODING_FAILED', reason);
    });
    return () => { active = false; };
  }, [addressResolver]);

  const capture = async () => {
    setShowPasteField(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setMessage('Kameros leidimas nesuteiktas.');
    const selected = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (selected.canceled) return;
    await prepareImages(selected.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? 'camera.jpg' })), 'camera');
  };

  const pickImages = async () => {
    setShowPasteField(false);
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
    assets: { uri: string; name: string }[],
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
    setShowPhotoSources(false);
    setShowPasteField(false);
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
    setShowPhotoSources(false);
    setShowPasteField(false);
    const selected = await DocumentPicker.getDocumentAsync({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (selected.canceled) return;
    setBusy(true);
    setMessage('Skaitomi Excel langeliai…');
    try {
      const hashes = new Set(excelBatchHashes);
      for (const asset of selected.assets) {
        const read = await readPickedExcelAsset(asset);
        hashes.add(read.sha256);
        excelBatchAssets.current.set(read.sha256, { name: asset.name, bytes: read.bytes });
        excelBytes.current = read.bytes;
        excelAsset.current = { name: asset.name, hash: read.sha256 };
        const preview = parseLogisticsExcelWorkbook(read.bytes, {
          importId: `excel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          fileName: asset.name,
          fileHash: read.sha256,
        });
        setColumnMapping(preview.mapping);
        // Save every eligible route sheet before opening any one of them. This
        // makes the workbook itself the first planning screen and keeps the
        // remaining work available after the first route has been created.
        for (const [index, sheet] of preview.sheets.entries()) {
          const existing = await excelRepository.findLatestByFingerprint(read.sha256, sheet.name);
          if (existing) continue;
          const sheetPreview = sheet.name === preview.selectedSheetName
            ? preview
            : parseLogisticsExcelWorkbook(read.bytes, {
              importId: `excel-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
              fileName: asset.name,
              fileHash: read.sha256,
              sheetName: sheet.name,
            });
          await excelRepository.savePreview(sheetPreview);
        }
      }
      setRememberedExcel(null);
      setExcelDuplicate(null);
      setExcelPreview(null);
      setResult(null);
      const batchHashes = [...hashes];
      setExcelBatchHashes(batchHashes);
      await excelRepository.saveActiveBatchFileHashes(batchHashes);
      setExcelSheetBatch(await excelRepository.listSheetSessions(batchHashes));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel failo perskaityti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const applySuggestedPlanningTime = (_windows: { from: string | null | undefined }[]) => {
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
      setShowExcelContent(recoveredResult.requiresReview);
      setMessage(`Atkurtas failas: ${rememberedExcel.preview.fileName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Prisiminto Excel atkurti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const openExcelPreview = async (preview: ExcelImportPreview, restoredResult?: ImportResult | null) => {
    await excelRepository.savePreview(preview);
    const base = restoredResult ?? excelPreviewToImportResult(preview);
    const pending = base.deliveries.filter((delivery) => delivery.validationState !== 'valid' || !delivery.selectedAddress);
    const resolvedPending = pending.length > 0 ? await resolveDeliveryAddresses(pending, addressResolver) : [];
    const resolvedById = new Map(resolvedPending.map((delivery) => [delivery.id, delivery]));
    const deliveries = base.deliveries.map((delivery) => resolvedById.get(delivery.id) ?? delivery);
    const imported: ImportResult = {
      ...base,
      deliveries,
      requiresReview: !preview.mappingRecognized
        || preview.rows.some((row) => !row.excluded && !row.normalizedAddress)
        || deliveries.some((delivery) => delivery.validationState !== 'valid' || !delivery.selectedAddress)
        || base.duplicates.length > 0,
    };
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
    setShowExcelContent(imported.requiresReview || !preview.mappingRecognized);
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
    if (!excelPreview) return;
    setBusy(true);
    try {
      const targetSheet = sheetName ?? excelPreview.selectedSheetName;
      if (targetSheet !== excelPreview.selectedSheetName && !mappingConfirmed) {
        const stored = await excelRepository.findLatestByFingerprint(excelPreview.fileHash, targetSheet);
        if (stored) {
          await openExcelPreview(stored, await excelRepository.getReviewResult(stored.id));
          return;
        }
      }
      if (!excelBytes.current || !excelAsset.current) {
        setMessage('Šis lapas nebuvo išsaugotas senesnio importo metu. Vieną kartą pasirinkite Excel failą dar kartą — nauji importai išsaugos visus jo lapus.');
        return;
      }
      const parsed = parseLogisticsExcelWorkbook(excelBytes.current, {
        importId: targetSheet === excelPreview.selectedSheetName
          ? excelPreview.id
          : `excel-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        fileName: excelAsset.current.name,
        fileHash: excelAsset.current.hash,
        sheetName: targetSheet,
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
      devWarn('EXCEL_REVIEW_PERSIST_FAILED', reason);
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
          devWarn('EXCEL_CORRECTION_AUDIT_FAILED', reason);
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
      if (!selectedStartEndpoint) throw new Error('Pasirinkta išvykimo vieta nenustatyta. Patikrinkite interneto ryšį ir vietų nustatymus.');
      const startLocation: RouteEndpoint = selectedStartEndpoint;
      const endLocation: RouteEndpoint = selectedStartEndpoint;
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
      void requestSync('mutation');
      // Importo metu adresai jau patikrinami automatiškai. Neverskite
      // dispečerio spausti dar vieno tarpinio „patikrinti“ mygtuko.
      router.push({
        pathname: '/route/[id]/alternatives',
        params: { id: created.routeId, returnTo: 'import' },
      });
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
              devWarn('ACTIVE_ROUTE_REDIRECT_FAILED', reason);
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

  const routeCreationBlockers = [
    ...(startMode === null ? ['Pasirinkite sandėlį, iš kurio prasidės maršrutas.'] : []),
    ...getRouteCreationBlockers({
      result,
      excelPreview,
      planningMode,
      warehouseEndpoint: selectedStartEndpoint,
      homeEndpoint: null,
      endMode,
      manuallyResolvedRowIds: new Set(Object.keys(manualRowResolutions)),
    }),
  ];
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
  const hasInternalImportStep = Boolean(result || excelDuplicate || document || showPhotoSources || showPasteField || excelSheetBatch.length > 0);

  const returnToSourceChooser = () => {
    if (result) {
      if (excelPreview && excelBatchHashes.length === 0) setRememberedExcel({ preview: excelPreview, result });
      setResult(null);
      setExcelPreview(null);
      setExcelDuplicate(null);
      setExpandedExcelGroups([]);
      setShowExcelContent(false);
      setMessage(null);
      if (excelBatchHashes.length > 0) {
        void excelRepository.listSheetSessions(excelBatchHashes).then(setExcelSheetBatch);
      }
      return;
    }
    if (excelDuplicate) {
      setExcelDuplicate(null);
      setMessage(null);
      return;
    }
    if (document) {
      setDocument(null);
      setMessage(null);
      return;
    }
    if (showPhotoSources || showPasteField) {
      setShowPhotoSources(false);
      setShowPasteField(false);
      return;
    }
    if (excelSheetBatch.length > 0) {
      setExcelSheetBatch([]);
      setExcelBatchHashes([]);
      void excelRepository.saveActiveBatchFileHashes([]);
      setMessage(null);
      return;
    }
    router.replace((profile.role === 'admin' || profile.role === 'dispatcher' ? '/dispatcher' : '/history') as Href);
  };

  const openExcelSheet = async (sheet: ExcelSheetSession) => {
    setBusy(true);
    try {
      const preview = await excelRepository.getPreview(sheet.id);
      if (!preview) throw new Error('Excel lapo duomenys nerasti.');
      const asset = excelBatchAssets.current.get(sheet.fileHash);
      if (asset) {
        excelBytes.current = asset.bytes;
        excelAsset.current = { name: asset.name, hash: sheet.fileHash };
      }
      setColumnMapping(preview.mapping);
      await openExcelPreview(preview, await excelRepository.getReviewResult(sheet.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel lapo atidaryti nepavyko.');
    } finally {
      setBusy(false);
    }
  };

  const removeExcelSheet = async (sheet: ExcelSheetSession) => {
    await excelRepository.abandonSession(sheet.id);
    const next = await excelRepository.listSheetSessions(excelBatchHashes);
    setExcelSheetBatch(next);
    if (next.length === 0) {
      setExcelBatchHashes([]);
      await excelRepository.saveActiveBatchFileHashes([]);
    }
  };

  const removeExcelFile = (file: { fileHash: string; fileName: string; sheets: ExcelSheetSession[] }) => {
    Alert.alert(
      'Pašalinti šį Excel failą?',
      `Bus pašalinti visi „${file.fileName}" lapai (${file.sheets.length}).`,
      [
        { text: 'Ne', style: 'cancel' },
        {
          text: 'Taip, pašalinti',
          style: 'destructive',
          onPress: () => { void (async () => {
            for (const sheet of file.sheets) await excelRepository.abandonSession(sheet.id);
            const remainingHashes = excelBatchHashes.filter((hash) => hash !== file.fileHash);
            setExcelBatchHashes(remainingHashes);
            await excelRepository.saveActiveBatchFileHashes(remainingHashes);
            setExcelSheetBatch(await excelRepository.listSheetSessions(remainingHashes));
          })(); },
        },
      ],
    );
  };

  return (
    <>
    <Stack.Screen options={{
      gestureEnabled: false,
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable accessibilityLabel={hasInternalImportStep ? 'Grįžti į importo šaltinius' : 'Grįžti'} accessibilityRole="button" onPress={returnToSourceChooser} style={styles.headerAction}>
          <Text style={styles.headerText}>{hasInternalImportStep ? '← Šaltiniai' : '← Atgal'}</Text>
        </Pressable>
      ),
    }} />
    <FoundationScreen
      showFoundationNotice={false}
      showHeading={!result}
      title="Importuoti maršrutą"
      description="Pasirinkite vieną duomenų šaltinį. Kitame žingsnyje galėsite patikrinti turinį.">
      <View style={styles.content}>
        {!result ? (excelSheetBatch.length > 0 ? (
          <View style={styles.sheetQueue} testID="excel-sheet-queue">
            <View style={styles.sheetQueueHeader}>
              <View style={styles.sheetQueueCopy}>
                <Text style={styles.sheetQueueTitle}>Pasirinkite planuojamą Excel lapą</Text>
                <Text style={styles.helper}>Žaliai pažymėti jau suplanuoti lapai. Rudi dar laukia planavimo.</Text>
              </View>
              <Pressable disabled={busy} style={styles.secondaryButton} onPress={pickExcel} testID="add-more-excel-files">
                <Text style={styles.secondaryText}>+ Pridėti Excel</Text>
              </Pressable>
            </View>
            {groupExcelSheetSessions(excelSheetBatch).map((file) => (
              <View key={file.fileHash} style={styles.sheetFileCard}>
                <View style={styles.sheetFileHeader}>
                  <View style={styles.sourceIconBadge}><ExcelIcon size={22} /></View>
                  <Text numberOfLines={1} style={styles.fileText}>{file.fileName}</Text>
                  <Pressable accessibilityLabel={`Pašalinti failą ${file.fileName}`} onPress={() => removeExcelFile(file)} style={styles.sheetDeleteButton} testID={`delete-excel-file-${file.fileHash}`}>
                    <Text style={styles.sheetDeleteText}>×</Text>
                  </Pressable>
                </View>
                <View style={styles.sheetList}>
                  {file.sheets.map((sheet) => {
                    const routed = sheet.status === 'routed';
                    return <View key={sheet.id} style={[styles.sheetRow, routed ? styles.sheetRowRouted : styles.sheetRowWaiting]}>
                      <Pressable disabled={busy} onPress={() => { void openExcelSheet(sheet); }} style={styles.sheetOpenButton} testID={`open-excel-sheet-${sheet.id}`}>
                        <View style={styles.sheetRowCopy}>
                          <Text style={styles.sheetName}>{sheet.sheetName}</Text>
                          <Text style={styles.sheetMeta}>{sheet.stopCount} taškų · {formatWeight(sheet.totalWeightGrams)}</Text>
                        </View>
                        <Text style={[styles.sheetStatus, routed ? styles.sheetStatusRouted : styles.sheetStatusWaiting]}>{routed ? 'Suplanuotas' : sheet.status === 'review' ? 'Reikia patikrinti' : 'Laukia planavimo'}</Text>
                      </Pressable>
                      <Pressable accessibilityLabel={`Pašalinti lapą ${sheet.sheetName}`} onPress={() => { void removeExcelSheet(sheet); }} style={styles.sheetDeleteButton} testID={`delete-excel-sheet-${sheet.id}`}>
                        <Text style={styles.sheetDeleteText}>×</Text>
                      </Pressable>
                    </View>;
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : <>
        <Text style={styles.sourceDivider}>PASIRINKITE ŠALTINĮ</Text>
        <View style={styles.sourceGrid}>
          <Pressable style={styles.excelPrimaryButton} onPress={pickExcel} testID="pick-excel">
            <View style={styles.sourceIconBadge}><ExcelIcon size={24} /></View>
            <View style={styles.excelPrimaryText}>
              <Text style={styles.sourceButtonTitle}>Pasirinkti Excel failą</Text>
              <Text style={styles.sourceButtonHint}>.xlsx · galima pasirinkti lapą</Text>
            </View>
          </Pressable>
          <SourceButton
            styles={styles}
            title="Nuotrauka"
            description="Kamera arba galerija"
            icon={<CameraIcon size={24} />}
            onPress={() => { setShowPhotoSources((current) => !current); setShowPasteField(false); }}
          />
          <SourceButton styles={styles} title="PDF dokumentas" description="Vienas dokumentas" icon={<PdfIcon size={24} />} onPress={pickPdf} />
          <SourceButton
            styles={styles}
            title="Įklijuoti tekstą"
            description="Adresai eilutėmis"
            icon={<ClipboardIcon size={24} />}
            onPress={() => { setShowPasteField((current) => !current); setShowPhotoSources(false); }}
            testID="toggle-paste-field"
          />
        </View>

        {showPhotoSources ? (
          <View style={styles.inlineSourcePanel} testID="photo-source-options">
            <Text style={styles.cardTitle}>Kaip pridėti nuotraukas?</Text>
            <View style={styles.sourceGrid}>
              <SourceButton styles={styles} title="Fotografuoti" description="Atidaryti kamerą" icon={<CameraIcon size={22} />} onPress={capture} compact />
              <SourceButton styles={styles} title="Iš galerijos" description="Iki 10 nuotraukų" icon={<GalleryIcon size={22} />} onPress={pickImages} compact />
            </View>
          </View>
        ) : null}

        {rememberedExcel && !excelDuplicate ? (
          <View style={styles.card} testID="remembered-excel-card">
            <Text style={styles.cardTitle}>Anksčiau įkeltas Excel</Text>
            <Text style={styles.helper}>
              {rememberedExcel.preview.fileName} · {rememberedExcel.preview.selectedSheetName} · {rememberedExcel.preview.summary.physicalStopCount} taškų
            </Text>
            <Text style={styles.helper}>Failo iš naujo kelti nereikia — galite tęsti šio arba kito jo lapo planavimą.</Text>
            <Pressable style={styles.primaryButton} onPress={() => { void restoreRememberedExcel(); }} testID="restore-remembered-excel">
              <Text style={styles.primaryText}>Tęsti iš šio Excel</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setRememberedExcel(null)}>
              <Text style={styles.secondaryText}>Rinktis kitą failą</Text>
            </Pressable>
          </View>
        ) : null}

        {showPasteField ? (
          <View style={styles.card}>
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
          </View>
        ) : null}

        {document ? (
          <View style={styles.selectedFileCard}>
            <View style={styles.selectedFileRow}>
              {document.kind === 'pdf' ? <PdfIcon size={24} /> : <GalleryIcon size={24} />}
              <View style={styles.selectedFileText}>
                <Text numberOfLines={1} style={styles.fileText}>{document.fileName}</Text>
                <Text style={styles.compactMeta}>{document.pageCount} psl. · paruošta atpažinimui</Text>
              </View>
              <Pressable accessibilityLabel="Pašalinti pasirinktą dokumentą" onPress={() => setDocument(null)} style={styles.clearFileButton}>
                <Text style={styles.clearFileText}>×</Text>
              </Pressable>
            </View>
            <Pressable disabled={busy} style={[styles.primaryButton, busy && styles.disabled]} onPress={analyze}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Atpažinti dokumentą</Text>}
            </Pressable>
          </View>
        ) : null}
        </>) : (
          <View style={styles.importFileCard} testID="selected-import-file">
            <View style={styles.selectedFileRow}>
              <View style={styles.sourceIconBadge}>{excelPreview ? <ExcelIcon size={24} /> : <ClipboardIcon size={24} />}</View>
              <View style={styles.selectedFileText}>
                <Text numberOfLines={1} style={styles.fileText}>{excelPreview?.fileName ?? document?.fileName ?? 'Importuoti duomenys'}</Text>
                <Text style={styles.compactMeta}>
                  {excelPreview
                    ? `${excelPreview.selectedSheetName} · ${excelPreview.summary.physicalStopCount} tšk. · ${formatWeight(excelPreview.summary.totalWeightGrams)}`
                    : `${result.deliveries.length} pristatymo taškų`}
                </Text>
              </View>
              <Pressable style={styles.changeFileButton} onPress={returnToSourceChooser} testID="change-import-source">
                <Text style={styles.linkText}>Keisti</Text>
              </Pressable>
            </View>
            {excelPreview ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showExcelContent }}
                onPress={() => setShowExcelContent((current) => !current)}
                style={styles.accordionHeader}
                testID="toggle-excel-content">
                <View style={styles.accordionText}>
                  <Text style={styles.accordionTitle}>Peržiūrėti failo turinį</Text>
                  <Text style={excelProblemCount > 0 ? styles.issueText : styles.accordionMeta}>
                    {excelProblemCount > 0 ? `${excelProblemCount} taškus reikia patikrinti` : `${excelPreview.groups.length} pristatymo taškų · suskleista`}
                  </Text>
                </View>
                {showExcelContent ? <ChevronDownIcon color={colors.textMuted} /> : <ChevronRightIcon color={colors.textMuted} />}
              </Pressable>
            ) : null}
          </View>
        )}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {result && (!excelPreview || excelProblemCount === 0) ? (
          <View style={styles.routeSetupTop} testID="route-setup-top">
            <View style={styles.accordionHeader} testID="route-setup-visible">
              <View style={styles.accordionText}>
                <Text style={styles.setupTitle}>Maršruto nustatymai</Text>
                <Text numberOfLines={2} style={styles.accordionMeta}>
                  {planningDate} · {planningTime}{'\n'}Sandėlis: {startMode === 'kretinga' ? 'Kretingos' : 'numatytasis'}
                </Text>
              </View>
            </View>

            <View style={styles.warehouseChoiceBlock} testID="start-location-choice">
              <Text style={styles.setupRowLabel}>SANDĖLIS</Text>
              <Text style={styles.setupRowMeta}>Parinktas numatytasis. Keiskite tik jei maršrutas išvyksta iš kito sandėlio.</Text>
              <View style={styles.endSwitchRow}>
                <Pressable
                  disabled={!warehouseEndpoint?.latitude}
                  onPress={() => setStartMode('warehouse')}
                  style={[styles.endSwitchOption, startMode === 'warehouse' && styles.endSwitchOptionActive, !warehouseEndpoint?.latitude && styles.disabled]}>
                  <Text style={[styles.endSwitchText, startMode === 'warehouse' && styles.endSwitchTextActive]}>Numatytasis sandėlis</Text>
                </Pressable>
                <Pressable
                  disabled={!kretingaEndpoint?.latitude}
                  onPress={() => setStartMode('kretinga')}
                  style={[styles.endSwitchOption, startMode === 'kretinga' && styles.endSwitchOptionActive, !kretingaEndpoint?.latitude && styles.disabled]}>
                  <Text style={[styles.endSwitchText, startMode === 'kretinga' && styles.endSwitchTextActive]}>Kretingos sandėlis</Text>
                </Pressable>
              </View>
            </View>

            <Pressable style={styles.setupRow} onPress={() => setEditingSchedule((current) => !current)} testID="toggle-schedule-edit">
              <View style={styles.setupRowText}>
                <Text style={styles.setupRowLabel}>DATA IR IŠVYKIMO LAIKAS</Text>
                <Text numberOfLines={1} style={styles.setupRowValue}>{planningDate} · {planningTime}</Text>
              </View>
              <View style={styles.setupEditBadge}><PencilIcon size={17} color={colors.brandNavy} /></View>
            </Pressable>

            {editingSchedule ? (
              <View style={styles.setupEditPanel}>
                <View style={styles.scheduleRow}>
                  <View style={styles.scheduleField}>
                    <Text style={styles.fieldCaption}>Data</Text>
                    <DateInput
                      value={planningDate}
                      onChangeText={setPlanningDate}
                      style={styles.scheduleInput}
                      placeholderTextColor={colors.textMuted}
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
                <Pressable style={styles.inlineLinkRow} onPress={() => router.push('/settings/locations' as Href)}>
                  <Text style={styles.inlineLinkText}>Keisti numatytąjį sandėlį nustatymuose</Text>
                </Pressable>
              </View>
            ) : null}

            {excelPreview && allRouteCodes(excelPreview).length > 0 ? (
              <View style={styles.regionSection} testID="region-summary">
                <View style={styles.regionHeaderRow}>
                  <RegionIcon size={16} color={colors.textMuted} />
                  <Text style={styles.setupRowLabel}>RAJONAI · palieskite, kad neįtrauktumėte</Text>
                </View>
                <View style={styles.regionChipRow}>
                  {regionSummaries(excelPreview).map((region) => {
                    const active = excelPreview.selectedRouteCodes.includes(region.code);
                    return (
                      <Pressable
                        key={region.code}
                        onPress={() => { void toggleRouteCode(region.code); }}
                        style={[styles.regionChip, active ? styles.regionChipActive : styles.regionChipMuted]}
                        testID={`region-chip-${region.code}`}>
                        <Text style={[styles.regionChipCode, active && styles.regionChipCodeActive]}>{region.code}</Text>
                        <Text style={[styles.regionChipMeta, active && styles.regionChipMetaActive]}>
                          {region.stopCount} tšk · {formatWeight(region.weightGrams)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <Pressable
              style={styles.toggleRow}
              onPress={() => setPlanningMode((current) => current === 'with_time_windows' ? 'ignore_time_windows' : 'with_time_windows')}
              testID="toggle-planning-mode">
              <WindowIcon size={18} color={planningMode === 'with_time_windows' ? colors.brandNavy : colors.textMuted} />
              <View style={styles.setupRowText}>
                <Text style={styles.setupRowValue}>Atsižvelgti į pristatymo laikus</Text>
                <Text style={styles.setupRowMeta}>{planningMode === 'with_time_windows' ? 'Įjungta · derinama pagal laikus' : 'Išjungta · trumpiausias kelias'}</Text>
              </View>
              <View style={[styles.switchTrack, planningMode === 'with_time_windows' && styles.switchTrackOn]}>
                <View style={[styles.switchThumb, planningMode === 'with_time_windows' && styles.switchThumbOn]} />
              </View>
            </Pressable>

            {!readyForRoute ? (
              <View style={styles.blockerList} testID="route-creation-blockers">
                {excelPreview && excelProblemCount > 0 ? (
                  <Text style={styles.issueText}>Reikia sutvarkyti {excelProblemCount} pristatymo {excelProblemCount === 1 ? 'tašką' : 'taškus'}.</Text>
                ) : routeCreationBlockers.slice(0, 2).map((blocker) => <Text key={blocker} style={styles.issueText}>• {blocker}</Text>)}
                {!hasRouteCoordinates(selectedStartEndpoint) ? (
                  <Pressable style={styles.secondaryButton} onPress={() => router.push('/settings/locations' as Href)}>
                    <Text style={styles.secondaryText}>Atidaryti vietų nustatymus</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            <View style={styles.setupActions}>
              <Pressable
                disabled={busy}
                style={[styles.cancelSetupButton, busy && styles.disabled]}
                onPress={returnToSourceChooser}
                testID="cancel-route-setup">
                <Text style={styles.cancelSetupText}>Atšaukti</Text>
              </Pressable>
              <Pressable
                disabled={!readyForRoute || busy}
                style={[styles.createRouteButton, (!readyForRoute || busy) && styles.disabled]}
                onPress={sendToRouting}
                testID="create-route-top">
                <Text style={styles.primaryText}>Kurti maršrutą</Text>
              </Pressable>
            </View>
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

        {excelPreview && showExcelContent ? (
          <>
            <View style={styles.compactSummary}>
              <Text style={styles.summaryText}>Failo lapas ir adresai</Text>
              {excelPreview.sheets.length > 1 ? (
                <View style={styles.optionsPanel} testID="excel-sheet-picker">
                  <Text style={styles.label}>Excel lapas ({excelPreview.sheets.length} tinkami)</Text>
                  <View style={styles.choiceRow}>
                    {excelPreview.sheets.map((sheet) => (
                      <Choice styles={styles} key={sheet.name} label={sheet.name} selected={sheet.name === excelPreview.selectedSheetName} onPress={() => { void reparseExcel(sheet.name); }} />
                    ))}
                  </View>
                </View>
              ) : null}
              <Pressable style={styles.optionsToggle} onPress={() => setShowExcelOptions((current) => !current)}>
                <Text style={styles.secondaryText}>{showExcelOptions ? 'Slėpti išplėstines parinktis' : 'Išplėstinės eilučių parinktys'}</Text>
              </Pressable>
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
                      if (resolution && resolution.latitude !== null && resolution.longitude !== null) {
                        const sourceAddress = row.rawColumnE ?? row.rawColumnD ?? resolution.address;
                        void addressMemory.remember(sourceAddress, {
                          normalizedAddress: resolution.address,
                          latitude: resolution.latitude,
                          longitude: resolution.longitude,
                          placeId: null,
                          confidence: 1,
                        });
                      }
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
                {(Object.keys(columnMapping) as (keyof ExcelColumnMapping)[]).map((key) => (
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
              const unloadLabel = smelynes25UnloadLabel(rows);
              return (
                <View key={group.id} style={[styles.excelCompactCard, needsAction && styles.excelProblemCard]} testID={`excel-group-${group.id}`}>
                  <Text style={styles.cardTitle}>{group.normalizedAddress}</Text>
                  <Text style={styles.importantMeta}>{formatWeight(group.totalWeightGrams)} · {formatGroupTime(rows)}{unloadLabel ? ` · ${unloadLabel}` : ''}</Text>
                  {needsAction ? <Text style={styles.issueText}>{excelProblemText(group, delivery)}</Text> : null}
                  <Pressable style={styles.compactButton} onPress={() => setExpandedExcelGroups((current) => expanded ? current.filter((id) => id !== group.id) : [...current, group.id])}>
                    <Text style={styles.secondaryText}>{expanded ? 'Uždaryti taisymą' : needsAction ? 'Taisyti šį adresą' : 'Peržiūrėti'}</Text>
                  </Pressable>
                  {expanded && delivery ? (
                    <DeliveryEditor styles={styles} colors={colors} delivery={delivery} index={excelPreview.groups.indexOf(group)} onChange={updateField} onChooseAddress={chooseAddress} onBlurAddress={() => void revalidate()} compact />
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
                onBlurAddress={() => void revalidate()}
              />
            )) : null}
            {!excelPreview && result.duplicates.length ? (
              <View style={styles.warningCard}><Text style={styles.cardTitle}>Galimi dublikatai: {result.duplicates.length}</Text><Text style={styles.helper}>Patikrinkite pasikartojančius užsakymus ar panašius adresus.</Text></View>
            ) : null}
          </>
        ) : null}
      </View>
    </FoundationScreen>
    </>
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
  onBlurAddress?: () => void;
  compact?: boolean;
}) {
  const { styles, colors } = props;
  const [expandedOptionalFields, setExpandedOptionalFields] = useState<EditableField[]>([]);
  const [showCompactDetails, setShowCompactDetails] = useState(false);
  const fields: { key: EditableField; label: string; field: ImportField<string | number> }[] = [
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
              onBlur={key === 'address' ? props.onBlurAddress : undefined}
              style={[
                styles.input,
                field.value === null && !required
                  ? styles.neutralBorder
                  : styles[`${level}Border`],
              ]}
              placeholder={required ? 'Adresas, koordinatės arba Google Maps nuoroda' : 'Neprivaloma'}
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

function SourceButton({ styles, title, description, icon, onPress, compact = false, testID }: {
  styles: ReturnType<typeof createStyles>;
  title: string;
  description: string;
  icon: ReactNode;
  onPress: () => void;
  compact?: boolean;
  testID?: string;
}) {
  return (
    <Pressable accessibilityRole="button" style={[styles.sourceButton, compact && styles.sourceButtonCompact]} onPress={onPress} testID={testID}>
      <View style={styles.sourceIconBadge}>{icon}</View>
      <View style={styles.sourceButtonCopy}>
        <Text style={styles.sourceButtonTitle}>{title}</Text>
        <Text style={styles.sourceButtonHint}>{description}</Text>
      </View>
    </Pressable>
  );
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
  resolver: AddressLookupProvider;
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
      setError(sessionErrorMessage(reason) ?? (reason instanceof Error ? reason.message : 'Geokodavimas nepavyko.'));
    } finally {
      setBusy(false);
    }
  };

  // Google Maps' "copy coordinates" puts both numbers on one line
  // ("55.741800, 24.361800"). Recognise that shape in either box so a
  // straight paste fills both fields instead of forcing the driver to split
  // the text themselves.
  const handleManualLatChange = (value: string) => {
    const pair = matchCoordinatePairText(value);
    if (pair) {
      setManualLat(pair[0]);
      setManualLng(pair[1]);
      return;
    }
    setManualLat(value);
  };
  const handleManualLngChange = (value: string) => {
    const pair = matchCoordinatePairText(value);
    if (pair) {
      setManualLat(pair[0]);
      setManualLng(pair[1]);
      return;
    }
    setManualLng(value);
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
          <Text style={styles.fieldCaption}>Galite įklijuoti abu skaičius iš karto (kaip nukopijuota iš Google Maps).</Text>
          <TextInput value={manualLat} onChangeText={handleManualLatChange} keyboardType="decimal-pad" placeholder="Platuma, pvz. 55.7418 (arba abu iš karto)" placeholderTextColor={colors.textMuted} style={styles.input} />
          <TextInput value={manualLng} onChangeText={handleManualLngChange} keyboardType="decimal-pad" placeholder="Ilguma, pvz. 24.3618" placeholderTextColor={colors.textMuted} style={styles.input} />
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

/**
 * The gateway proxy requires a valid employee session even for geocoding, so
 * a stale session surfaces mid-import as a raw "[SESSION_INVALID] ..." error.
 * Give a plain explanation instead — re-logging in here would drop this
 * unsaved import, so tell them to do it in another tab and come back.
 */
function sessionErrorMessage(reason: unknown): string | null {
  const code = (reason as { code?: unknown } | undefined)?.code;
  const message = reason instanceof Error ? reason.message : '';
  if (code === 'SESSION_INVALID' || code === 'SESSION_EXPIRED' || code === 'SESSION_REQUIRED'
    || message.includes('SESSION_INVALID') || message.includes('SESSION_EXPIRED') || message.includes('SESSION_REQUIRED')) {
    return 'Jūsų prisijungimo sesija baigėsi. Šis importas neprarandamas — atidarykite naują naršyklės skirtuką, prisijunkite iš naujo, tada grįžkite čia ir bandykite dar kartą.';
  }
  return null;
}

/**
 * Recognises a pasted "lat, lng" (or "lat lng") pair, as copied straight out
 * of Google Maps or typed by hand, so a single paste can fill both
 * latitude/longitude boxes. Returns ["55.7418", "24.3618"] or null.
 */
const COORDINATE_PAIR_COMMA = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*$/;
const COORDINATE_PAIR_SPACED = /^\s*(-?\d+\.\d+)\s+(-?\d+\.\d+)\s*$/;
function matchCoordinatePairText(value: string): [string, string] | null {
  const pair = value.match(COORDINATE_PAIR_COMMA) ?? value.match(COORDINATE_PAIR_SPACED);
  if (!pair) return null;
  return [pair[1]!.replace(',', '.'), pair[2]!.replace(',', '.')];
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

type RegionSummary = { code: string; stopCount: number; weightGrams: number };

// Groups are the physical stops (deduped by address); a group's route code is
// taken from its first constituent Excel row, since every line at one delivery
// point belongs to the same region in practice.
function regionSummaries(preview: ExcelImportPreview): RegionSummary[] {
  const rowsById = new Map(preview.rows.map((row) => [row.id, row]));
  const byCode = new Map<string, RegionSummary>();
  for (const group of preview.groups) {
    const code = group.lineIds.map((id) => rowsById.get(id)?.routeCode).find((value): value is string => Boolean(value)) ?? 'Be regiono';
    const existing = byCode.get(code) ?? { code, stopCount: 0, weightGrams: 0 };
    existing.stopCount += 1;
    existing.weightGrams += group.totalWeightGrams;
    byCode.set(code, existing);
  }
  return [...byCode.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function groupExcelSheetSessions(sessions: ExcelSheetSession[]): { fileHash: string; fileName: string; sheets: ExcelSheetSession[] }[] {
  const files = new Map<string, { fileHash: string; fileName: string; sheets: ExcelSheetSession[] }>();
  for (const sheet of sessions) {
    const file = files.get(sheet.fileHash) ?? { fileHash: sheet.fileHash, fileName: sheet.fileName, sheets: [] };
    file.sheets.push(sheet);
    files.set(sheet.fileHash, file);
  }
  return [...files.values()];
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
  excelPrimaryButton: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 150,
    minHeight: 88,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.info,
    backgroundColor: colors.infoSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  excelPrimaryText: { flex: 1, minWidth: 0 },
  sourceDivider: { ...type.label, color: colors.textMuted, marginTop: spacing.xs },
  sourceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheetQueue: { gap: spacing.md },
  sheetQueueHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  sheetQueueCopy: { flex: 1, minWidth: 260 },
  sheetQueueTitle: { ...type.sectionTitle, color: colors.text },
  sheetFileCard: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  sheetFileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetList: { gap: spacing.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'stretch', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  sheetRowRouted: { borderColor: colors.success, backgroundColor: colors.accentSoft },
  sheetRowWaiting: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  sheetOpenButton: { flex: 1, minWidth: 0, minHeight: 64, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sheetRowCopy: { flex: 1, minWidth: 0 },
  sheetName: { ...type.bodyStrong, color: colors.text },
  sheetMeta: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  sheetStatus: { ...type.label, textAlign: 'right' },
  sheetStatusRouted: { color: colors.success },
  sheetStatusWaiting: { color: colors.warning },
  sheetDeleteButton: { width: 48, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: colors.border },
  sheetDeleteText: { fontSize: 26, lineHeight: 28, color: colors.textMuted },
  sourceButton: { flexGrow: 1, flexBasis: '47%', minWidth: 150, minHeight: 88, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  sourceButtonCompact: { minHeight: 68 },
  sourceIconBadge: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sourceButtonCopy: { flex: 1, minWidth: 0 },
  sourceButtonTitle: { ...type.bodyStrong, color: colors.text },
  sourceButtonHint: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  inlineSourcePanel: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  selectedFileCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.md },
  importFileCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  selectedFileRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectedFileText: { flex: 1, minWidth: 0 },
  clearFileButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  clearFileText: { ...type.sectionTitle, color: colors.textMuted },
  accordionHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  accordionText: { flex: 1, minWidth: 0 },
  accordionTitle: { ...type.bodyStrong, color: colors.text },
  accordionMeta: { ...type.meta, color: colors.textMuted, marginTop: 2 },
  headerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  headerText: { ...type.secondaryStrong, color: colors.brandNavy },
  card: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.sm },
  routeSetupTop: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderLeftWidth: 4, borderColor: colors.border, borderLeftColor: colors.brandNavy, backgroundColor: colors.surfaceElevated, gap: spacing.sm },
  warehouseChoiceBlock: { gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft },
  scheduleRow: { flexDirection: 'row', gap: spacing.sm },
  scheduleField: { flex: 1, minWidth: 0, gap: 4 },
  fieldCaption: { ...type.meta, color: colors.textMuted },
  scheduleInput: { minHeight: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.bodyStrong },
  compactSummary: { paddingHorizontal: spacing.xs, gap: 2 },
  regionList: { marginTop: 2, gap: 1 },
  setupHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  setupTitle: { ...type.sectionTitle, color: colors.text },
  setupCount: { ...type.secondaryStrong, color: colors.info },
  setupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  setupRowStatic: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  setupRowText: { flex: 1, minWidth: 0 },
  setupRowLabel: { ...type.label, fontSize: 10, lineHeight: 12, color: colors.textMuted },
  setupRowValue: { ...type.bodyStrong, color: colors.text, marginTop: 1 },
  setupRowMeta: { ...type.meta, color: colors.textMuted, marginTop: 1 },
  setupEditBadge: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  setupEditPanel: { gap: spacing.sm, paddingHorizontal: spacing.xs },
  inlineLinkRow: { minHeight: 34, justifyContent: 'center' },
  inlineLinkText: { ...type.secondaryStrong, color: colors.info, textDecorationLine: 'underline' },
  regionSection: { gap: spacing.xs },
  regionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  regionChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  regionChip: { minHeight: 46, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, justifyContent: 'center' },
  regionChipActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  regionChipMuted: { borderColor: colors.border, backgroundColor: colors.surfaceSubtle, opacity: 0.6 },
  regionChipCode: { ...type.secondaryStrong, color: colors.textMuted },
  regionChipCodeActive: { color: colors.info },
  regionChipMeta: { ...type.label, color: colors.textMuted, marginTop: 1 },
  regionChipMetaActive: { color: colors.text },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  switchTrack: { width: 48, height: 28, borderRadius: radius.pill, backgroundColor: colors.borderStrong, justifyContent: 'center', paddingHorizontal: 3 },
  switchTrackOn: { backgroundColor: colors.actionPrimary },
  switchThumb: { width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.textInverse },
  switchThumbOn: { alignSelf: 'flex-end' },
  endSwitchRow: { flexDirection: 'row', gap: spacing.xs },
  endSwitchOption: { flex: 1, minHeight: 52, paddingHorizontal: spacing.xs, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  endSwitchOptionActive: { borderColor: colors.info, backgroundColor: colors.infoSoft },
  endSwitchText: { ...type.secondaryStrong, color: colors.textMuted },
  endSwitchTextActive: { color: colors.info },
  endSwitchAddress: { ...type.meta, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  setupActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  cancelSetupButton: { flex: 1, minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelSetupText: { ...type.button, color: colors.textSecondary },
  createRouteButton: { flex: 2, minHeight: 52, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center' },
  excelCompactCard: { padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs },
  excelProblemCard: { borderColor: colors.danger, backgroundColor: colors.surface },
  compactMeta: { ...type.secondary, color: colors.textMuted },
  importantMeta: { ...type.bodyStrong, color: colors.text },
  compactButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.xs },
  compactEditor: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  endpointText: { ...type.bodyStrong, color: colors.text, paddingVertical: spacing.xs },
  confirmedEndpoint: { ...type.meta, color: colors.success },
  changeFileButton: { minHeight: 44, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  successText: { ...type.bodyStrong, color: colors.success },
  optionsToggle: { minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  optionsPanel: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  problemNavigator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navigatorButton: { minHeight: 44, minWidth: 104, borderRadius: radius.md, borderWidth: 1, borderColor: colors.info, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  problemCounter: { ...type.bodyStrong, color: colors.text, textAlign: 'center' },
  qualityCard: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.infoSoft },
  warningCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft },
  cardTitle: { ...type.sectionTitle, color: colors.text },
  summaryText: { ...type.bodyStrong, color: colors.text },
  issueText: { ...type.bodyStrong, color: colors.danger },
  blockerList: { gap: spacing.xs },
  excelRow: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  excludedRow: { opacity: 0.48 },
  rawText: { ...type.meta, color: colors.textMuted },
  miniButton: { minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  moveTargets: { gap: spacing.sm, paddingTop: spacing.sm },
  textArea: { minHeight: 150, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.body },
  primaryButton: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.actionPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  primaryText: { ...type.button, fontSize: 16, color: colors.textInverse },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  secondaryText: { ...type.button, color: colors.textSecondary },
  disabled: { opacity: 0.45 },
  fileText: { ...type.bodyStrong, color: colors.text, flex: 1, minWidth: 0 },
  message: { ...type.body, color: colors.textMuted },
  helper: { ...type.body, color: colors.textMuted, marginTop: spacing.xs },
  fieldGroup: { gap: 5 },
  optionalEmptyRow: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  optionalLabel: { ...type.secondaryStrong, color: colors.text, flexShrink: 1 },
  optionalValue: { ...type.secondary, color: colors.textMuted, textAlign: 'right' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...type.secondaryStrong, color: colors.text },
  confidence: { ...type.secondaryStrong },
  input: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surfaceSubtle, ...type.body },
  linkText: { ...type.secondaryStrong, color: colors.info, textDecorationLine: 'underline' },
  pasteToggleLink: { minHeight: 32, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xs },
  linkTextSmall: { ...type.secondaryStrong, color: colors.textMuted, textDecorationLine: 'underline' },
  high: { color: colors.success },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
  highBorder: { borderColor: colors.success },
  warningBorder: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  dangerBorder: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  neutralBorder: { borderColor: colors.border, backgroundColor: colors.surfaceSubtle },
  candidates: { gap: spacing.sm, marginTop: spacing.sm },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  choiceSelected: { backgroundColor: colors.infoSoft, borderColor: colors.info },
  choiceText: { ...type.secondaryStrong, color: colors.text },
  choiceTextSelected: { ...type.secondaryStrong, color: colors.info },
  candidateButton: { minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.info, backgroundColor: colors.infoSoft, padding: spacing.sm, justifyContent: 'center' },
  candidateText: { ...type.secondaryStrong, color: colors.info },
});
