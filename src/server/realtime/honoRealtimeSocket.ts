import type { RealtimeSocket } from "./sessionEventHub.js";
import type { WSContext } from "hono/ws";

export interface HonoRealtimeSocket extends RealtimeSocket {
  _triggerClose(): void;
}

export function createHonoRealtimeSocket(ws: WSContext): HonoRealtimeSocket {
  const closeListeners = new Set<() => void>();

  return {
    get OPEN(): number {
      return 1;
    },
    get readyState(): number {
      return ws.readyState;
    },
    send(payload: string): void {
      ws.send(payload);
    },
    on(event: "close", listener: () => void): unknown {
      if (event === "close") {
        closeListeners.add(listener);
      }
      return this;
    },
    _triggerClose(): void {
      for (const listener of closeListeners) {
        try {
          listener();
        } catch {
          // ignore error in close callback
        }
      }
      closeListeners.clear();
    },
  };
}
