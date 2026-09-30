import { change } from "../commands/document";
import { newObject, type Box, type PageModel } from "../state/model";
import { screenToPage } from "../viewer/coordinates";

export type TextMarkupKind = "highlight" | "underline" | "strike";
export interface SelectedFragment extends Box {
  text: string;
}
export interface SelectedPageText {
  pageId: string;
  fragments: SelectedFragment[];
}

/** Rectangles from browser selection are in screen coordinates. The content
 * rectangle describes the full un-cropped page after zoom and page rotation.
 */
export function selectionBox(
  page: PageModel,
  content: Box,
  rectangle: Box,
): Box | undefined {
  const rotated = page.rotation % 180 !== 0;
  const scale = content.width / (rotated ? page.height : page.width);
  if (!(scale > 0)) return;
  const points = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
  ].map((point) =>
    screenToPage(
      { x: point.x - content.x, y: point.y - content.y },
      page.width,
      page.height,
      page.rotation,
      scale,
    ),
  );
  const crop = page.crop ?? {
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
  };
  const x = Math.max(crop.x, Math.min(...points.map((p) => p.x)));
  const y = Math.max(crop.y, Math.min(...points.map((p) => p.y)));
  const right = Math.min(
    crop.x + crop.width,
    Math.max(...points.map((p) => p.x)),
  );
  const bottom = Math.min(
    crop.y + crop.height,
    Math.max(...points.map((p) => p.y)),
  );
  if (right <= x || bottom <= y) return;
  return { x, y, width: right - x, height: bottom - y };
}

/** Joining neighboring fragments reduces annotations while preserving lines. */
export function mergeTextFragments(
  fragments: SelectedFragment[],
): SelectedFragment[] {
  const result: SelectedFragment[] = [];
  for (const fragment of fragments) {
    const previous = result.at(-1);
    if (
      previous &&
      Math.abs(previous.y - fragment.y) < 0.5 &&
      Math.abs(previous.height - fragment.height) < 1 &&
      Math.abs(fragment.x - previous.x - previous.width) < 2
    ) {
      const right = Math.max(
        previous.x + previous.width,
        fragment.x + fragment.width,
      );
      previous.width = right - previous.x;
      previous.text += fragment.text;
    } else result.push({ ...fragment });
  }
  return result;
}

export function selectedTextMarkup(
  pages: SelectedPageText[],
  kind: TextMarkupKind,
) {
  const objects = new Map(
    pages.map((page) => [
      page.pageId,
      mergeTextFragments(page.fragments).map((fragment) => ({
        ...newObject(kind, fragment.x, fragment.y),
        ...fragment,
        ...(kind !== "highlight" ? { color: "#cc3845", strokeWidth: 1 } : {}),
      })),
    ]),
  );
  const first = pages.find((page) => objects.get(page.pageId)?.length);
  return {
    pageId: first?.pageId,
    objectId: first ? objects.get(first.pageId)?.[0].id : undefined,
    command: change("選択文字に注釈を追加", (model) => ({
      ...model,
      pages: model.pages.map((page) => ({
        ...page,
        objects: [...page.objects, ...(objects.get(page.id) ?? [])],
      })),
    })),
  };
}
