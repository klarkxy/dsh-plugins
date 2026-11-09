import { createHash } from 'node:crypto'

export const supportedVersion = '0.2.2-rc.1'
export const originalSha256 = '74e834b85e44f75874198bb0e937de98fd78c2bc0c5145cc14032185f579731f'
export const sha256 = value => createHash('sha256').update(value).digest('hex')

/** The first live graph often repeats the HTML boot graph while its batch is
 * still in flight. Switching those rows to single-resource URLs schedules a
 * second script for the same factories. An identical graph has nothing to
 * invalidate or remap. Real graph changes retain the Host's existing path.
 */
export function patchClientModules(original) {
  if (sha256(original) !== originalSha256) throw new Error('Unsupported client-modules artifact; review this Host release before patching')
  const source = String(original)
  const anchor = '\t\t\tupdateManifest(manifest, managed) {\n'
  if (source.split(anchor).length !== 2) throw new Error('Missing or ambiguous updateManifest implementation')
  return source.replace(anchor, anchor
    + '\t\t\t\t// Identical live/boot graphs must share their in-flight batch URLs.\n'
    + '\t\t\t\tif (manifest.rev === this.manifest.rev) return;\n')
}
