import "@testing-library/jest-dom/vitest";

// jsdom no implementa las APIs de layout que los componentes del registro usan
// para decidir el modo móvil del sidebar y para medir y anclar el hilo de
// mensajes. Sin estos stubs el render falla antes de llegar a cualquier
// aserción, así que se declaran una sola vez para toda la suite.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof globalThis.ResizeObserver !== "function") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// La lista pide su página siguiente con un centinela observado, y el hilo deriva
// de la visibilidad qué mensaje es el más antiguo en pantalla. En jsdom no hay
// layout, así que el stub trata todo lo observado como visible: es el equivalente
// a una conversación que cabe entera en la ventana.
if (typeof globalThis.IntersectionObserver !== "function") {
  globalThis.IntersectionObserver = class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(element: Element) {
      this.callback(
        [{ isIntersecting: true, intersectionRatio: 1, target: element } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
