/**
 * Where an imported image (/media/<name>) is displayed from. The desktop app serves
 * /media itself; the phone app keeps images in its database and shows them through
 * object URLs (src/mobile/bridge.ts sets the resolver).
 */
let resolver: ((name: string) => string | undefined) | null = null;

export function setMediaResolver(fn: (name: string) => string | undefined): void {
  resolver = fn;
}

/** The URL to show an image from. */
export function mediaSrc(src: string): string {
  if (!resolver || !src.startsWith('/media/')) return src;
  return resolver(src.slice('/media/'.length)) ?? src;
}

/** Same for every image of some HTML. */
export function withMediaUrls(html: string): string {
  if (!resolver) return html;
  return html.replace(/(<img\b[^>]*\bsrc=")(\/media\/[^"]+)"/g, (_m, before: string, src: string) => `${before}${mediaSrc(src)}"`);
}
