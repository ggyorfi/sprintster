import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineCommand } from 'citty';
import type { EventInput, EventRow } from '@sprintster/engine';
import { loadProjectConfig, projectConfigPath, selectEnvironment } from '../project-config.js';
import { openBackend } from '../backends.js';
import { failClean } from '../fail.js';

const EVENTS = 'events.ndjson';
const BLOBS = 'blobs';
const TYPES = 'blobs.json';
const BATCH = 200;
const HASH = /^[0-9a-f]{64}$/;
const BLOB_STREAM = '__blob';

// Blobs are only reachable through the events that reference them, by hash, anywhere in a payload.
export function hashesIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (HASH.test(value)) out.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => hashesIn(v, out));
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((v) => hashesIn(v, out));
  }
  return out;
}

const toInput = ({ id: _id, recordedAt: _recordedAt, ...input }: EventRow): EventInput => input;

export const exportCommand = defineCommand({
  meta: { name: 'export', description: 'Write the event log and every blob it references to a folder' },
  args: {
    dir: { type: 'positional', description: 'folder to write', required: true },
    env: { type: 'string', description: 'environment to export', default: 'dev' },
  },
  async run({ args }) {
    try {
      const project = loadProjectConfig(projectConfigPath());
      const environment = selectEnvironment(project, args.env);
      const backend = await openBackend(environment.backend, environment.blobs.dir);
      try {
        const events = await backend.store.findSince(0);
        mkdirSync(join(args.dir, BLOBS), { recursive: true });
        writeFileSync(join(args.dir, EVENTS), events.map((e) => JSON.stringify(toInput(e))).join('\n') + '\n');
        const types: Record<string, string | null> = {};
        for (const hash of hashesIn(events.map((e) => e.payload))) {
          const blob = await backend.blobStore.getBlob(hash);
          if (blob === null) continue;
          writeFileSync(join(args.dir, BLOBS, hash), blob.bytes);
          types[hash] = blob.contentType;
        }
        writeFileSync(join(args.dir, TYPES), JSON.stringify(types, null, 2));
        console.log(`exported ${events.length} events and ${Object.keys(types).length} blobs to ${args.dir}`);
      } finally {
        await backend.close();
      }
    } catch (err) {
      failClean(err);
    }
  },
});

export const importCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Load an export into an empty app over its API (password from SPRINTSTER_PASSWORD)',
  },
  args: {
    dir: { type: 'positional', description: 'folder written by s8r export', required: true },
    url: { type: 'positional', description: "the app's URL", required: true },
    user: { type: 'string', description: 'user for an app behind a password' },
  },
  async run({ args }) {
    try {
      const base = args.url.replace(/\/$/, '');
      const headers: Record<string, string> =
        args.user === undefined
          ? {}
          : { authorization: `Basic ${Buffer.from(`${args.user}:${process.env['SPRINTSTER_PASSWORD'] ?? ''}`).toString('base64')}` };
      const types = JSON.parse(readFileSync(join(args.dir, TYPES), 'utf8')) as Record<string, string | null>;
      let uploaded = 0;
      for (const hash of readdirSync(join(args.dir, BLOBS))) {
        if ((await fetch(`${base}/assets/${hash}`, { method: 'HEAD', headers })).ok) continue;
        const form = new FormData();
        form.append('file', new Blob([readFileSync(join(args.dir, BLOBS, hash))], { type: types[hash] ?? '' }), hash);
        const res = await fetch(`${base}/assets`, { method: 'POST', headers, body: form });
        if (!res.ok) throw new Error(`uploading blob ${hash} failed: ${res.status} ${await res.text()}`);
        uploaded++;
      }
      const start = (await (await fetch(`${base}/log`, { headers })).json()) as { position: number; changes: unknown[] };
      if (start.changes.length > 0) throw new Error(`${base} already holds records; import only into an empty app`);
      // Uploading a blob records its own event in the target, so the exported ones would collide.
      const lines = readFileSync(join(args.dir, EVENTS), 'utf8')
        .split('\n')
        .filter((l) => l !== '' && (JSON.parse(l) as EventInput).streamType !== BLOB_STREAM);
      let position = start.position;
      for (let i = 0; i < lines.length; i += BATCH) {
        const events = lines.slice(i, i + BATCH).map((l) => JSON.parse(l) as EventInput);
        const res = await fetch(`${base}/log`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ after: position, events }),
        });
        const body = (await res.json()) as { position?: number; message?: string };
        if (!res.ok) throw new Error(`importing events ${i + 1}-${i + events.length} failed: ${body.message ?? res.status}`);
        position = body.position ?? position;
        console.log(`events ${Math.min(i + BATCH, lines.length)}/${lines.length}`);
      }
      console.log(`imported ${lines.length} events and ${uploaded} new blobs into ${base}`);
    } catch (err) {
      failClean(err);
    }
  },
});
