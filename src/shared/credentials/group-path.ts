/**
 * Group slugs and the slash-joined slug chains that address a group.
 *
 * Imports nothing: the Electron main process, the `tiginal cred` CLI, and the
 * renderer all compile against this file, and the CLI is a plain Node process.
 */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function joinGroupPath(slugs: readonly string[]): string {
  return slugs.filter(slug => slug !== '').join('/');
}

export function splitGroupPath(path: string): string[] {
  return path.split('/').filter(segment => segment !== '');
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
