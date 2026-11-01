import * as vitest from 'vitest';
import { describeEventStore, describeStateStore } from '../testing.js';
import { InMemoryEventStore } from './store.js';

describeEventStore(vitest, 'in memory', () => new InMemoryEventStore());
describeStateStore(vitest, 'in memory', () => new InMemoryEventStore());
