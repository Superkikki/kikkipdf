/** Cryptographic signatures are a separate, replaceable native provider. */
export interface DigitalSignatureProvider {
  sign(pdf: Uint8Array, certificateId: string): Promise<Uint8Array>;
}
