/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 *
 */
export enum CTXTrackerMethod {
  ClearRect = 'clearRect',
  DrawImage = 'drawImage',
  SetTransform = 'setTransform',
  Restore = 'restore'
}

type MethodArgs<T> = T extends (...args: infer A) => any ? A : never

export type CTXTrackerCallback<M extends CTXTrackerMethod> = (
  ctx: CanvasRenderingContext2D,
  args: MethodArgs<CanvasRenderingContext2D[M]>
) => void

const CTX = CanvasRenderingContext2D.prototype

export const ORIGINALCTX = {} as typeof CTX

for (const prop in CTX) {
  try {
    if (typeof (CTX as any)[prop] !== 'function') continue
    ;(ORIGINALCTX as any)[prop] = (CTX as any)[prop]
  } catch (e) {
    /* swallowed */
  }
}

export const createCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  const old = canvas.getContext as any
  canvas.getContext = (...args: any[]): any => {
    if (args.length > 0) {
      const [contextId] = args
      if (contextId === '2d') {
        const ctx = old.apply(canvas, args)
        for (const prop in ORIGINALCTX) ctx[prop] = (ORIGINALCTX as any)[prop]
        return ctx
      }
    }
    return old.apply(canvas, args)
  }
  return canvas
}

export const createOffscreenCanvas = (width: number, height: number): OffscreenCanvas => {
  return new OffscreenCanvas(width, height)
}

export type CTXTrackerCallbackObject<M extends CTXTrackerMethod> =
  | CTXTrackerCallback<M>
  | {
      before?: CTXTrackerCallback<M>
      after?: CTXTrackerCallback<M>
    }

export const CTXTracker = {
  intercept<M extends CTXTrackerMethod>(method: M, callback: CTXTrackerCallbackObject<M>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalMethod = CTX[method] as any
    if (typeof callback === 'function') {
      CTX[method] = new Proxy(originalMethod, {
        apply(target, ctx: CanvasRenderingContext2D, args: MethodArgs<CanvasRenderingContext2D[M]>) {
          callback(ctx, args)
          return target.apply(ctx, args)
        }
      })
    } else {
      CTX[method] = new Proxy(originalMethod, {
        apply(target, ctx: CanvasRenderingContext2D, args: MethodArgs<CanvasRenderingContext2D[M]>) {
          callback.before?.apply(null, [ctx, args])
          const result = target.apply(ctx, args)
          callback.after?.apply(null, [ctx, args])
          return result
        }
      })
    }
  }
}
