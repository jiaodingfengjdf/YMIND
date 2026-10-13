// Document media is embedded. Rendering a document never fetches its URLs.
export function safeImage(value?: string): string | undefined {
  return value &&
    value.length <= (16 * 1024 * 1024 * 4) / 3 &&
    /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[\da-z+/]+={0,2}$/i.test(
      value,
    )
    ? value
    : undefined;
}
export function safeLink(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function safeFile(value?: string): string | undefined {
  return value &&
    value.length <= 32 * 1024 * 1024 &&
    /^data:[\w.+/-]+(?:;charset=[\w-]+)?;base64,[\da-z+/]+={0,2}$/i.test(value)
    ? value
    : undefined;
}
