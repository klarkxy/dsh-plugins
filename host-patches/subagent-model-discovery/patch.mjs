import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { discoveryDescription } from './list-models.mjs'

export const targets = {
  'dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js': 'de7b10aaf52b1b1616d13a831a9ece1f820b8a6302fe94667f31b6d641b2f46e',
  'dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js': '99b5c20830a52f69641df8a18a39206079b0c725201958cce2c4a934f1d4f7cd',
}
export const sha256 = value => createHash('sha256').update(value).digest('hex')

function replaceOnce(source, before, after) {
  const index = source.indexOf(before)
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) throw new Error('Host patch anchor is missing or ambiguous')
  return source.slice(0, index) + after + source.slice(index + before.length)
}

/** Patch only the exact inspected host code; other releases must be reviewed again. */
export function patchHostFile(path, original) {
  if (!Object.hasOwn(targets, path) || sha256(original) !== targets[path]) throw new Error(`Unsupported host code: ${path}`)
  let source = Buffer.isBuffer(original) ? original.toString('utf8') : original
  if (path.includes('dsh-tool-subagent/')) {
    const start = source.indexOf('/** Model-facing discovery of LLM routes available to child Agents. */')
    const end = source.indexOf('/**\n* Register `list_subagent_models`', start)
    if (start < 0 || end < start) throw new Error('Host discovery implementation was not found')
    const replacement = readFileSync(new URL('./list-models.mjs', import.meta.url), 'utf8').replace(/^export /gm, '')
    source = source.slice(0, start) + replacement + source.slice(end)
    source = replaceOnce(source,
      'description: "Discover LLM routes for subagents without changing the current Agent. Call with no arguments to list registered providers, with `provider` to list its advertised models, or with `provider` and `model` to inspect that exact model and its reasoning efforts. Catalog membership is advisory: an adapter may accept an unlisted model id. Use the returned ids with a delegation tool\'s `provider`, `model`, and `reasoning_effort` fields.",',
      `description: ${JSON.stringify(discoveryDescription)},`)
    source = replaceOnce(source, 'description: "Registered LLM provider id. Omit to list providers."', 'description: "Exact provider id from the current Session allowed routes. Omit to list every allowed route."')
    source = replaceOnce(source, 'description: "Exact model id to inspect. Requires provider; omit to list that provider\'s advertised models."', 'description: "Exact model id, without adding the provider prefix. Requires provider; omit to list every allowed model for that provider."')
  } else {
    source = replaceOnce(source,
      '\t\t\ttry {\n\t\t\t\tawait this.config.resolveApiKey(provider, profile);\n\t\t\t} catch (error) {\n\t\t\t\tif (error instanceof LlmError && error.code === "MISSING_CREDENTIAL") return [];\n\t\t\t\tthrow error;\n\t\t\t}',
      '\t\t\ttry {\n\t\t\t\tawait this.config.resolveApiKey(provider, profile);\n\t\t\t} catch (error) {\n\t\t\t\tif (error instanceof LlmError && error.code === "MISSING_CREDENTIAL") throw new LlmError("Provider credentials are missing; configure them before selecting a model.", "MISSING_CREDENTIAL");\n\t\t\t\tthrow error;\n\t\t\t}')
  }
  return Buffer.from(source)
}
