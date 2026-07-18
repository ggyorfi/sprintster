import type { CommandConfig, ObjectConfig, TransitionConfig } from '../config/schema.js';

export interface LifecycleInfo {
  field: string;
  kind: 'softDelete' | 'statusField';
  initial: unknown;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// Event name for a transition: explicit `event` wins, otherwise derived from the destination state (e.g. invoice + paid -> InvoicePaid).
export function transitionEventName(objectName: string, transition: TransitionConfig): string {
  return transition.event ?? `${capitalize(objectName)}${capitalize(transition.to)}`;
}

export interface CommandEventInfo {
  command: CommandConfig;
  eventType: string;
}

export function commandEventInfos(obj: ObjectConfig): CommandEventInfo[] {
  return (obj.commands ?? []).map((command) => ({
    command,
    eventType: transitionEventName(obj.name, command.transition),
  }));
}

// softDelete is a boolean flag (init false, flipped true on remove); statusField is an enum (init to its config default; both lifecycle fields are excluded from the create/update schemas, so a statusField transition is a future named command, not a generic field edit, and has no remove).
export function lifecycleInfo(obj: ObjectConfig): LifecycleInfo {
  if ('softDelete' in obj.lifecycle) {
    return { field: obj.lifecycle.softDelete, kind: 'softDelete', initial: false };
  }
  const field = obj.lifecycle.statusField;
  const prop = obj.properties.find((p) => p.name === field);
  return { field, kind: 'statusField', initial: prop?.default };
}
