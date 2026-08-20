// Side-effect setup for jsdom-based interaction tests in apps/web.
//
// The repo's default vitest environment is `node` (most web tests render via
// renderToStaticMarkup). Interaction tests that need a real DOM opt in with a
// per-file `// @vitest-environment jsdom` docblock AND a top-of-file
// `import '<path>/test/interaction-setup'`. Keeping setup here (rather than a
// global vitest `setupFiles`) means the node-env suite is completely unaffected.
import '@testing-library/jest-dom/vitest'

// jsdom does not implement the Pointer Events API or scrollIntoView, which
// Radix UI primitives (Select, Dialog, etc.) call on pointer interaction.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

// ResizeObserver is not available in jsdom; Radix's size hooks depend on it.
if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
