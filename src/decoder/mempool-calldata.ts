const TRANSFER_SELECTOR = '0xa9059cbb';

/** Decode an ERC20 transfer(address,uint256) calldata blob.
 *  Returns null if the input is malformed or not a transfer() call. */
export function decodeUsdtTransfer(input: string): { to: string; value: string } | null {
  if (typeof input !== 'string') return null;
  // selector (10 chars: '0x' + 8 hex) + 2 × 32-byte params (2 × 64 hex chars) = 138
  if (input.length < 138) return null;
  if (!input.toLowerCase().startsWith(TRANSFER_SELECTOR)) return null;
  try {
    // chars 0-9 = '0x' + selector; chars 10-73 = first param (64 hex, 32 bytes)
    // Address is the last 20 bytes (40 hex chars) of param 0.
    const to = '0x' + input.slice(34, 74).toLowerCase();
    const valueHex = input.slice(74, 138);
    const value = BigInt('0x' + valueHex).toString();
    return { to, value };
  } catch {
    return null;
  }
}
