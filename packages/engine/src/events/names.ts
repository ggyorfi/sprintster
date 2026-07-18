export interface ObjectEventNames {
  added: string;
  fieldChanged: string;
  removed: string;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export function eventTypeNames(objectName: string): ObjectEventNames {
  const base = capitalize(objectName);
  return { added: `${base}Added`, fieldChanged: `${base}FieldChanged`, removed: `${base}Removed` };
}

export function objectIdKey(objectName: string): string {
  return `${objectName}_id`;
}
