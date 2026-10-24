import assert from 'node:assert/strict';
import test from 'node:test';
import { installCanvasObserver } from '../src/canvas-observer.ts';

function fixture(draw) {
  class Context {}
  Object.defineProperty(Context.prototype, 'drawImage', { value: draw, writable: true, configurable: true });
  return { page: { CanvasRenderingContext2D: Context }, context: new Context(), prototype: Context.prototype };
}

test('canvas observation preserves native receivers, image identity, overload arguments, returns, and errors', () => {
  const result = {};
  const failure = new TypeError('native draw failure');
  const calls = [];
  const { page, context } = fixture(function (...args) {
    calls.push({ receiver: this, args });
    if (args[0] === 'invalid') throw failure;
    return result;
  });
  const observed = [];
  const hook = installCanvasObserver(page);
  hook.subscribe((receiver, args) => observed.push({ receiver, args }));
  const image = {};
  for (const args of [[image, 1, 2], [image, 1, 2, 64, 64], [image, 0, 0, 64, 64, 1, 2, 128, 128]]) {
    assert.equal(context.drawImage(...args), result);
    assert.equal(calls.at(-1).receiver, context);
    assert.equal(calls.at(-1).args[0], image);
    assert.deepEqual(calls.at(-1).args, args);
    assert.deepEqual(observed.at(-1), calls.at(-1));
  }
  assert.throws(() => context.drawImage('invalid', 0, 0), (error) => error === failure);
  assert.equal(observed.length, 3, 'failed native draws must not produce terrain observations');
  hook.dispose();
});

test('observer exceptions and replacement subscriptions cannot disrupt native drawing or another runtime', () => {
  const { page, context, prototype } = fixture(() => 42);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'drawImage');
  const hook = installCanvasObserver(page);
  let previous = 0;
  let current = 0;
  const removePrevious = hook.subscribe(() => { previous++; throw new Error('diagnostic failure'); });
  const removeCurrent = hook.subscribe(() => current++);
  assert.equal(context.drawImage({}, 0, 0), 42);
  removePrevious();
  assert.equal(context.drawImage({}, 0, 0), 42);
  assert.equal(previous, 1);
  assert.equal(current, 2);
  removePrevious();
  removeCurrent();
  hook.dispose();
  hook.dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'drawImage'), descriptor);
});

test('Firefox-style filtered arguments forward exact original objects and restore the native descriptor', () => {
  const image = {};
  let nativeReceiver;
  let nativeImage;
  const { page, context, prototype } = fixture(function (source) { nativeReceiver = this; nativeImage = source; });
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'drawImage');
  const filtered = (value) => value && typeof value === 'object' ? { wrappedJSObject: value } : value;
  const hook = installCanvasObserver(page, (fn, target, key) => {
    const exported = function (...args) { return Reflect.apply(fn, filtered(this), args.map(filtered)); };
    Object.defineProperty(target, key, { value: exported, configurable: true, writable: true, enumerable: true });
    return function (...args) { return Reflect.apply(exported, this, args); };
  });
  let observed;
  hook.subscribe((receiver, args) => { observed = { receiver, image: args[0] }; });
  context.drawImage(image, 1, 2);
  assert.equal(nativeReceiver, context);
  assert.equal(nativeImage, image);
  assert.deepEqual(observed, { receiver: context, image });
  hook.dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'drawImage'), descriptor);
});

test('cleanup leaves later hooks intact and unavailable drawing fails subscriptions explicitly', () => {
  const { page, prototype } = fixture(() => {});
  const hook = installCanvasObserver(page);
  const later = () => {};
  prototype.drawImage = later;
  hook.dispose();
  assert.equal(prototype.drawImage, later);
  const unavailable = installCanvasObserver({});
  assert.throws(() => unavailable.subscribe(() => {}), /unavailable/);
  unavailable.dispose();
});

test('an exporter that fails to install a callable cannot claim observation is available', () => {
  for (const installed of [undefined, 42]) {
    const { page } = fixture(() => {});
    const hook = installCanvasObserver(page, (fn, target, key) => {
      Object.defineProperty(target, key, { value: installed, configurable: true });
      return fn;
    });
    assert.throws(() => hook.subscribe(() => {}), /Cannot observe/);
    hook.dispose();
  }
});
