import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveUrl, watchLog, type LiveSocket } from './live.js';

function sockets() {
  const opened: LiveSocket[] = [];
  const connect = () => {
    const s: LiveSocket = { onopen: null, onmessage: null, onclose: null, close: () => s.onclose?.() };
    opened.push(s);
    return s;
  };
  return { opened, connect };
}

describe('watchLog (ADR 28)', () => {
  afterEach(() => vi.useRealTimers());

  it('builds the socket URL from the daemon URL', () => {
    expect(liveUrl('https://admin.example.com/', 'https://x')).toBe('wss://admin.example.com/log/live');
    expect(liveUrl('/api', 'http://localhost:5173/admin')).toBe('ws://localhost:5173/api/log/live');
  });

  it('reports pushes, and a reconnect as a change, retrying ever more slowly', async () => {
    vi.useFakeTimers();
    const { opened, connect } = sockets();
    const onChange = vi.fn();
    const watch = watchLog('ws://d/log/live', { onChange, connect });
    opened[0]!.onopen!();
    expect(onChange).not.toHaveBeenCalled();
    opened[0]!.onmessage!();
    expect(onChange).toHaveBeenCalledTimes(1);
    opened[0]!.onclose!();
    await vi.advanceTimersByTimeAsync(1000);
    opened[1]!.onclose!();
    await vi.advanceTimersByTimeAsync(1999);
    expect(opened).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    opened[2]!.onopen!();
    expect(onChange).toHaveBeenCalledTimes(2);
    watch.close();
  });

  it('does not reconnect while held, and does once released', async () => {
    vi.useFakeTimers();
    const { opened, connect } = sockets();
    const watch = watchLog('ws://d/log/live', { onChange: () => {}, connect });
    watch.hold(true);
    opened[0]!.onclose!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(opened).toHaveLength(1);
    watch.hold(false);
    expect(opened).toHaveLength(2);
    watch.close();
  });
});
