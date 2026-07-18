const DEFAULT_SCROLL_OFF = 2;

export function loadScrollOff(): number {
  const raw = Number(process.env['SPRINTSTER_SCROLL_OFF']);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_SCROLL_OFF;
}
