import * as vitest from 'vitest';
import Database from 'better-sqlite3';
import { describeEventStore, describeStateStore } from '@sprintster/engine/testing';
import { createSqliteEventStore } from './store.js';

const fresh = () => createSqliteEventStore(new Database(':memory:'));

describeEventStore(vitest, 'sqlite', fresh);
describeStateStore(vitest, 'sqlite', fresh);
