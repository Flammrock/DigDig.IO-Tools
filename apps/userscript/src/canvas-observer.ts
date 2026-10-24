export type DrawObserver = (context: CanvasRenderingContext2D, args: unknown[]) => void;
type Exporter = (fn: Function, target?: object, key?: string) => Function;

/** Observe completed draws. Native arguments, return values and errors stay intact. */
export function installCanvasObserver(page: Window & typeof globalThis, exporter?: Exporter) {
  const observers = new Set<DrawObserver>();
  let failure = '';
  let restore = () => {};
  const unwrap = <T>(value: T): T => {
    if (!exporter || value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    return (value as T & { wrappedJSObject?: T }).wrappedJSObject ?? value;
  };
  try {
    const prototype = page.CanvasRenderingContext2D?.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'drawImage');
    if (!prototype || typeof descriptor?.value !== 'function') throw new Error('Canvas 2D drawing is unavailable');
    const original = descriptor.value as Function;
    function observed(this: CanvasRenderingContext2D, ...args: unknown[]) {
      const context = unwrap(this);
      const forwarded = args.map(unwrap);
      const result = Reflect.apply(original, context, forwarded);
      for (const observer of observers) {
        try { observer(context, forwarded); } catch { /* Observation must never fail the game's draw. */ }
      }
      return result;
    }
    if (exporter) exporter(observed, prototype, 'drawImage');
    else Object.defineProperty(prototype, 'drawImage', { ...descriptor, value: observed });
    const installed = prototype.drawImage;
    if (typeof installed !== 'function' || installed === original) throw new Error('Cannot observe CanvasRenderingContext2D.drawImage');
    restore = () => {
      if (prototype.drawImage === installed) Object.defineProperty(prototype, 'drawImage', descriptor);
    };
  } catch (error) { failure = String(error); }
  return {
    subscribe(observer: DrawObserver) {
      if (failure) throw new Error(failure);
      observers.add(observer);
      return () => { observers.delete(observer); };
    },
    dispose() { observers.clear(); restore(); }
  };
}
