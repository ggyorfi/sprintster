import { describe, it, expect } from 'vitest';
import { slugify, objectRoute } from './route.js';

describe('slugify', () => {
  it('leaves a well-behaved label unchanged apart from case', () => {
    expect(slugify('Pages')).toBe('pages');
    expect(slugify('Posts')).toBe('posts');
    expect(slugify('Menu')).toBe('menu');
    expect(slugify('Categories')).toBe('categories');
    expect(slugify('Tags')).toBe('tags');
  });

  it('replaces whitespace with a single hyphen', () => {
    expect(slugify('Site Settings')).toBe('site-settings');
    expect(slugify('  Site   Settings  ')).toBe('site-settings');
  });

  it('folds accents to ASCII', () => {
    expect(slugify('Beállítások')).toBe('beallitasok');
    expect(slugify('Übersichten')).toBe('ubersichten');
    expect(slugify('Événements')).toBe('evenements');
  });

  it('collapses underscores and punctuation runs', () => {
    expect(slugify('order_items')).toBe('order-items');
    expect(slugify('Q&A Entries')).toBe('q-a-entries');
    expect(slugify('Invoices / Credit Notes')).toBe('invoices-credit-notes');
  });

  it('drops characters outside [a-z0-9-]', () => {
    expect(slugify('Orders™')).toBe('orders');
    expect(slugify('设置')).toBe('');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('-Pages-')).toBe('pages');
    expect(slugify('...Pages...')).toBe('pages');
  });

  it('keeps digits', () => {
    expect(slugify('Q1 Reports')).toBe('q1-reports');
  });

  it('is idempotent', () => {
    for (const label of ['Site Settings', 'Beállítások', 'Q&A Entries', 'Orders™']) {
      expect(slugify(slugify(label))).toBe(slugify(label));
    }
  });
});

describe('objectRoute', () => {
  it('derives the route from titlePlural', () => {
    expect(objectRoute({ titlePlural: 'Site Settings' })).toBe('site-settings');
  });

  it('prefers an explicit route over the label', () => {
    expect(objectRoute({ titlePlural: 'Site Settings', route: 'config-panel' })).toBe('config-panel');
  });
});
