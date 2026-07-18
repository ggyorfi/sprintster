export function failClean(err: unknown): never {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
