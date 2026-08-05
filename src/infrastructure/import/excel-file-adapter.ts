import * as Crypto from 'expo-crypto';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';

export async function readPickedExcelAsset(asset: DocumentPickerAsset): Promise<{
  bytes: Uint8Array;
  sha256: string;
}> {
  const bytes = asset.file
    ? new Uint8Array(await asset.file.arrayBuffer())
    : await new ExpoFile(asset.uri).bytes();
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return { bytes, sha256: bytesToHex(new Uint8Array(digest)) };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
