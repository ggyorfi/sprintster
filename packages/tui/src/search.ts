import { filterByConfig, type ObjectConfig, type SearchSpec } from '@sprintster/engine';

export function makeFilter<T extends object>(obj: ObjectConfig): (rows: readonly T[], query: string) => T[] {
  const search = obj.lists[0]?.search;
  const spec: SearchSpec = { fields: search?.fields ?? [], idPrefix: search?.idPrefix ?? false };
  return (rows, query) => filterByConfig(rows, query, spec);
}
