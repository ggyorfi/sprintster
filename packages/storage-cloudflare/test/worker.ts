import { DurableObject } from 'cloudflare:workers';

// A bare Durable Object whose storage the tests drive through runInDurableObject.
export class TestStore extends DurableObject {}

export default {
  fetch: () => new Response('test worker'),
};
