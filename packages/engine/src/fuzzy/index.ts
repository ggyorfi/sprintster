export function fuzzyMatch(label: string, query: string): number[] | null {
  if (query.length === 0) return [];
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  const matches: number[] = [];
  let li = 0;
  for (const qc of q) {
    const found = l.indexOf(qc, li);
    if (found < 0) return null;
    matches.push(found);
    li = found + 1;
  }
  return matches;
}

export interface FuzzyHit<T extends { label: string }> {
  option: T;
  matches: number[];
}

export function fuzzyFilter<T extends { label: string }>(options: readonly T[], query: string): FuzzyHit<T>[] {
  if (query.length === 0) return options.map((option) => ({ option, matches: [] }));
  const out: FuzzyHit<T>[] = [];
  for (const option of options) {
    const m = fuzzyMatch(option.label, query);
    if (m !== null) out.push({ option, matches: m });
  }
  return out;
}
