import * as vitest from 'vitest';
import { describeEventStore, describeStateStore, describeStateQuery } from '../testing.js';
import { InMemoryEventStore } from './store.js';

describeEventStore(vitest, 'in memory', () => new InMemoryEventStore());
describeStateStore(vitest, 'in memory', () => new InMemoryEventStore());
describeStateQuery(vitest, 'in memory', () => new InMemoryEventStore());
