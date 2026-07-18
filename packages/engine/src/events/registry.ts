import { z } from 'zod';
import { appConfig } from '../config/app-config.js';
import { commandEventInfos } from '../engine/lifecycle.js';
import { eventTypeNames, objectIdKey } from './names.js';

function buildSchemas(): Record<string, z.ZodTypeAny> {
  const schemas: Record<string, z.ZodTypeAny> = {};
  for (const obj of appConfig.objects) {
    const names = eventTypeNames(obj.name);
    const id = z.object({ [objectIdKey(obj.name)]: z.string() });
    schemas[`${names.added}@1`] = id.catchall(z.unknown());
    schemas[`${names.fieldChanged}@1`] = id.extend({ field: z.string().min(1), value: z.unknown() });
    schemas[`${names.removed}@1`] = id;
    for (const ce of commandEventInfos(obj)) {
      schemas[`${ce.eventType}@1`] = id;
    }
  }
  return schemas;
}

let SCHEMAS: Record<string, z.ZodTypeAny> | undefined;

function getSchemas(): Record<string, z.ZodTypeAny> {
  if (SCHEMAS === undefined) SCHEMAS = buildSchemas();
  return SCHEMAS;
}

export function invalidateEventSchemas(): void {
  SCHEMAS = undefined;
}

export type EventKey = string;

export function eventKey(type: string, version: number): string {
  return `${type}@${version}`;
}

export function getEventSchema(type: string, version: number): z.ZodTypeAny | undefined {
  return getSchemas()[eventKey(type, version)];
}

export function isKnownEvent(type: string, version: number): boolean {
  return getEventSchema(type, version) !== undefined;
}

export function allEventKeys(): readonly string[] {
  return Object.keys(getSchemas());
}
