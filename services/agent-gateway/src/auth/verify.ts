import { verifyMessage, getAddress, type Address } from 'viem';

export async function verifyWalletSignature(
  message: string,
  signature: string,
  expectedWallet: string,
): Promise<Address | null> {
  try {
    const checksummed = getAddress(expectedWallet);
    const valid = await verifyMessage({
      address: checksummed,
      message,
      signature: signature as `0x${string}`,
    });

    return valid ? checksummed : null;
  } catch {
    return null;
  }
}
