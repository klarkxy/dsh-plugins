import { describe, expect, it } from 'vitest'
import { editedPromptBlocks } from './retry-content.ts'

const file = { type: 'file' as const, attachment: { attachmentId: 'file', name: 'a.txt', bytes: 3 } }
const image = { type: 'image' as const, attachment: { attachmentId: 'image', name: 'a.png', mediaType: 'image/png', width: 1, height: 1, bytes: 4 } }
const text = (value: string) => ({ type: 'text' as const, text: value })

describe('ordered edited prompt blocks', () => {
  it('leaves unchanged multi-part input byte-for-byte identical', () => {
    const original = [file, text('before'), image, text('after')]
    expect(JSON.stringify(editedPromptBlocks(original, undefined))).toBe(JSON.stringify(original))
    expect(JSON.stringify(editedPromptBlocks(original, 'beforeafter'))).toBe(JSON.stringify(original))
  })

  it('keeps a file before edited text and retains text around an image', () => {
    const original = [file, text('before A'), image, text(' after')]
    expect(editedPromptBlocks(original, 'before B after')).toEqual([file, text('before B'), image, text(' after')])
    expect(editedPromptBlocks(original, 'before A afterward')).toEqual([file, text('before A'), image, text(' afterward')])
  })

  it('replaces a range spanning an attachment without moving that attachment', () => {
    expect(editedPromptBlocks([text('left OLD'), image, text(' OLD right'), file], 'left NEW right'))
      .toEqual([text('left NEW'), image, text(' right'), file])
  })

  it('preserves Unicode and attachment-only input when adding or clearing text', () => {
    expect(editedPromptBlocks([text('前😀'), image, text('后🌲')], '前😁后🌲'))
      .toEqual([text('前😁'), image, text('后🌲')])
    expect(editedPromptBlocks([file, image], 'new')).toEqual([file, image, text('new')])
    expect(editedPromptBlocks([file, text('remove'), image], '')).toEqual([file, text(''), image])
  })
})
