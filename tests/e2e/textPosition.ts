import type { Locator } from "@playwright/test";

/** Compare source text in page coordinates. Opening the properties panel changes
 * the viewport position and fit scale without moving text within the PDF. */
export function textPosition(locator: Locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el);
    return { x: parseFloat(style.left), y: parseFloat(style.top) };
  });
}
