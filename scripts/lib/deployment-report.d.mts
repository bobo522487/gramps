/** 名词的单 / 复数形式，如 `['table', 'tables']`。只读，避免调用方误改。 */
export type Noun = readonly [one: string, many: string];

export function plural(count: number, one: string, many: string): string;

export function describeMissing<T>(
  missing: readonly T[],
  noun: Noun,
  render?: (item: T) => string
): string;

export function describeWrong<T>(
  wrong: readonly T[],
  total: number,
  noun: Noun,
  render?: (item: T) => string
): string;
