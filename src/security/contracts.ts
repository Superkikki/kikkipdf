/** Cryptographic signatures and office conversions are separate, replaceable native providers. */
export interface DigitalSignatureProvider {
  sign(pdf: Uint8Array, certificateId: string): Promise<Uint8Array>;
}
export interface OfficeConversionProvider {
  convert(path: string, signal: AbortSignal): Promise<Uint8Array>;
}
