// ADR 28: the client side of the daemon's live log socket.

export interface LiveSocket {
  onopen: (() => void) | null;
  onmessage: (() => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface LiveOptions {
  // Called when the log moved, and after a reconnect, since changes made while away were never pushed.
  onChange(): void;
  onConnected?(connected: boolean): void;
  // Runs before each reconnect, so a client can renew a session the socket's handshake was refused for.
  beforeRetry?(): Promise<unknown>;
  connect?(url: string): LiveSocket;
}

export interface LiveWatch {
  // While held, a dropped socket is not reopened; releasing reopens it.
  hold(on: boolean): void;
  close(): void;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

// `base` is the daemon's URL, absolute or relative to `origin`.
export function liveUrl(base: string, origin: string): string {
  const url = new URL(`${base.replace(/\/$/, '')}/log/live`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

export function watchLog(url: string, opts: LiveOptions): LiveWatch {
  const connect = opts.connect ?? ((u: string) => new WebSocket(u) as unknown as LiveSocket);
  let socket: LiveSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = FIRST_RETRY_MS;
  let opened = false;
  let stopped = false;
  let held = false;
  let waiting = false;

  const open = () => {
    if (stopped) return;
    if (held) {
      waiting = true;
      return;
    }
    const s = connect(url);
    socket = s;
    s.onopen = () => {
      delay = FIRST_RETRY_MS;
      opts.onConnected?.(true);
      if (opened) opts.onChange();
      opened = true;
    };
    s.onmessage = () => opts.onChange();
    s.onclose = () => {
      if (socket !== s || stopped) return;
      socket = undefined;
      opts.onConnected?.(false);
      timer = setTimeout(() => void (opts.beforeRetry?.() ?? Promise.resolve()).catch(() => undefined).then(open), delay);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    };
  };

  open();
  return {
    hold(on) {
      held = on;
      if (!on && waiting) {
        waiting = false;
        open();
      }
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
