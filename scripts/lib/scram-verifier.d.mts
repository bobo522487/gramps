/** `scripts/lib/scram-verifier.mjs` 的类型面。 */
export const SCRAM_ITERATIONS: number;

export function scramSha256(password: string, salt?: Buffer): string;
