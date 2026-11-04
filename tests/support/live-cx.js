// gpui's Context for one host call: it is valid only for the call that produced it (gpui-kit.d.ts, Context), and
// the real app throws when a kept one is used later. Runs `fn` with such a cx over `cx`, and kills it on return.
// A task from cx.spawn gets `cx` itself, as the app gives a spawn its own context that outlives the call.
export function during(cx, fn) {
  let live = true;
  const scoped = new Proxy(cx, {
    get(target, key) {
      if (!live) throw new Error(`stale context: cx.${String(key)} used after its call returned`);
      return target[key];
    },
  });
  try {
    return fn(scoped);
  } finally {
    live = false;
  }
}
