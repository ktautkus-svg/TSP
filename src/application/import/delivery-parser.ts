import { meanConfidence } from '@/domain/import/confidence';
import { DOCUMENT_TEMPLATES } from '@/domain/import/document-templates';
import type { DocumentTemplateId, ImportField, ParsedDelivery } from '@/domain/import/models';

const ADDRESS_PATTERN = /\b([\p{L}][\p{L} .'’-]{1,50}[ \t](?:g\.|gatvė|pr\.|prospektas|al\.|pl\.)[ \t]*\d+[\p{L}]?(?:[-/]\d+)?(?:,?[ \t]*[\p{L}][\p{L} .'-]+)?)/iu;
const WEIGHT_PATTERN = /\b(\d+(?:[.,]\d+)?)\s*(kg|t)\b/iu;
const TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[-–]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?\b/u;
const PHONE_PATTERN = /(?:\+370|00370|8)[\s-]?(?:\d[\s-]?){8}\b/u;
const ORDER_PATTERN = /(?:užsak(?:ymas|ymo\s*nr\.?|ymo)|order(?:\s*no\.?)?|siuntos?\s*nr\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/iu;

export function normalizeOcrText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseDeliveries(
  rawText: string,
  templateId: DocumentTemplateId = 'generic',
): ParsedDelivery[] {
  const text = normalizeOcrText(rawText);
  if (!text) return [];
  const template = DOCUMENT_TEMPLATES[templateId];
  return splitDeliveryBlocks(text).map((block, index) => parseBlock(block, index, template));
}

export function splitDeliveryBlocks(text: string): string[] {
  const explicit = text.split(/\n\s*\n/u).map((item) => item.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const startsAddress = ADDRESS_PATTERN.test(line);
    if (startsAddress && current.some((item) => ADDRESS_PATTERN.test(item))) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks.map((block) => block.join('\n'));
}

function parseBlock(
  block: string,
  index: number,
  template: (typeof DOCUMENT_TEMPLATES)[DocumentTemplateId],
): ParsedDelivery {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const addressMatch = block.match(ADDRESS_PATTERN);
  const namedPlaceAddress = addressMatch ? null : extractNamedPlaceAddress(lines);
  const addressValue = addressMatch
    ? appendPostalCity(addressMatch[1]!.trim(), block)
    : namedPlaceAddress;
  const weightMatch = block.match(WEIGHT_PATTERN);
  const timeMatch = block.match(TIME_PATTERN);
  const phoneMatch = block.match(PHONE_PATTERN);
  const orderMatch = block.match(ORDER_PATTERN);
  const recipient = labeledValue(lines, template.recipientLabels);
  const notes = labeledValue(lines, template.notesLabels);
  const address = field(
    addressValue,
    addressMatch ? 0.94 : namedPlaceAddress ? 0.72 : 0.18,
    addressMatch?.[0] ?? namedPlaceAddress,
  );
  const orderNumber = field(orderMatch?.[1] ?? null, orderMatch ? 0.93 : 0, orderMatch?.[0]);
  const weightKg = field(
    weightMatch ? toKilograms(weightMatch[1], weightMatch[2]) : null,
    weightMatch ? 0.9 : 0,
    weightMatch?.[0],
  );
  const deliveryTime = field(timeMatch?.[0] ?? null, timeMatch ? 0.88 : 0, timeMatch?.[0]);
  const phone = field(phoneMatch ? normalizePhone(phoneMatch[0]) : null, phoneMatch ? 0.91 : 0, phoneMatch?.[0]);
  const recipientField = field(recipient?.value ?? null, recipient ? 0.86 : 0, recipient?.evidence);
  const inferredNotes = notes?.value ?? (namedPlaceAddress ? null : inferNotes(lines));
  const notesField = field(inferredNotes, notes ? 0.82 : inferredNotes ? 0.45 : 0, notes?.evidence);
  // Missing optional fields are not recognition failures. They do not lower
  // parser quality and are not presented as low-confidence data.
  const parsedFields = [address, orderNumber, weightKg, deliveryTime, phone, recipientField, notesField];
  const parserConfidence = meanConfidence(
    parsedFields.filter((item) => item.value !== null).map((item) => item.confidence),
  );
  return {
    id: `delivery-${index + 1}`,
    sourcePage: null,
    rawText: block,
    address,
    addressQuery: address.value,
    orderNumber,
    weightKg,
    deliveryTime,
    phone,
    recipient: recipientField,
    notes: notesField,
    parserConfidence,
    addressConfidence: address.confidence,
    importConfidence: meanConfidence([parserConfidence, address.confidence]),
    addressCandidates: [],
    selectedAddress: null,
    validationState: address.value ? 'pending' : 'invalid',
  };
}

function field<T>(value: T | null, confidence: number, evidence?: string | null): ImportField<T> {
  return { value, confidence, evidence: evidence ?? null, manuallyCorrected: false };
}

function labeledValue(lines: string[], labels: string[]) {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^${escapeRegExp(label)}\\s*[:#-]\\s*(.+)$`, 'iu'));
      if (match) return { value: match[1].trim(), evidence: line };
    }
  }
  return null;
}

function inferNotes(lines: string[]): string | null {
  const candidates = lines.filter((line) =>
    !ADDRESS_PATTERN.test(line) && !WEIGHT_PATTERN.test(line) && !TIME_PATTERN.test(line) &&
    !PHONE_PATTERN.test(line) && !ORDER_PATTERN.test(line),
  );
  return candidates.length > 0 ? candidates.at(-1)! : null;
}

function extractNamedPlaceAddress(lines: string[]): string | null {
  if (lines.length !== 1) return null;
  const value = lines[0]!.trim();
  if (value.length < 8 || value.length > 220) return null;
  if (WEIGHT_PATTERN.test(value) || TIME_PATTERN.test(value) || PHONE_PATTERN.test(value)) return null;
  return /^[\p{L}\d .,'’()/-]+,\s*[\p{L} .'-]{2,}$/u.test(value) ? value : null;
}

function appendPostalCity(address: string, block: string): string {
  const postalCity = block.match(
    /(?:^|,)[ \t]*((?:LT-?)?\d{5}[ \t]+[\p{L} .'-]{2,})(?=$|,)/mu,
  )?.[1]?.trim();
  return postalCity && !address.includes(postalCity) ? `${address}, ${postalCity}` : address;
}

function toKilograms(raw: string, unit: string): number {
  const value = Number(raw.replace(',', '.'));
  return unit.toLocaleLowerCase('lt-LT') === 't' ? value * 1000 : value;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('00370')) return `+370${digits.slice(5)}`;
  if (digits.startsWith('370')) return `+${digits}`;
  if (digits.startsWith('8')) return `+370${digits.slice(1)}`;
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
