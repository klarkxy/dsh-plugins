/** Loader composition: fake model, same-session retry, free directory, and real delete. */

import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, projectActiveBranch } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { buildSessionEventSearchDocuments } from '@deepseek-ai/dsh-session-query/src/documents.ts'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { apply as applyStorageJson } from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import SessionController from '../packages/api/session-controller/src/index.ts'
import type { SessionRequestId } from '../packages/api/session-controller/src/types.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../packages/core/agent-loop/tests/mock-adapter.ts'

let root: string | undefined
let context: Context | undefined
const previousHome = process.env['DSH_HOME']


export async function boot(
  adapter: MockAdapter,
  registerTools: (ctx: Context) => void,
  existingHome?: string,
): Promise<Context> {
  root = existingHome ?? await mkdtemp(join(tmpdir(), 'dsh-session-loader-'))
  process.env['DSH_HOME'] = root
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- name: host-stubs',
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '- name: durable-services',
    '- name: scripted-model',
    "- name: '@deepseek-ai/dsh-api-session-controller'",
    '  config:',
    '    nativeOpen: false',
    '',
  ].join('\n'))
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const stubs = {
    name: 'host-stubs',
    apply(ctx: Context) {
      const dispose = (): void => {}
      ctx.provide('typert', {
        lookups: { configure: () => dispose },
        contexts: { configureHost: () => dispose },
      } as never)
      ctx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'mock', model: 'mock' }),
        saveSelection: () => Promise.resolve(),
      } as never)
      ctx.provide('attachments', {
        imageLimits: {
          maxImageBytes: 5 * 1024 * 1024,
          maxImagesPerMessage: 20,
          maxMessageImageBytes: 100 * 1024 * 1024,
          maxImagePixels: 40_000_000,
          maxImageDimension: 2000,
          mediaTypes: ['image/png'],
        },
        admitPromptContent: (content: readonly unknown[]) => Promise.resolve(content),
      } as never)
      ctx.provide('fileUploads', {
        registerAgentResolver: () => dispose,
        resolve: () => undefined,
        bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
        retirePrompt: () => {},
      } as never)
      ctx.provide('workspaceRegistry', {
        get: () => undefined,
        list: () => [],
        archivedSessionIds: [],
      } as never)
      ctx.provide('fileReferences', { list: () => [] } as never)
      ctx.provide('connection', { fetch: { register: () => dispose } } as never)
      ctx.provide('fs', {} as never)
    },
  }
  const durable = {
    name: 'durable-services',
    inject: ['sessions'],
    async apply(ctx: Context) {
      const home = root
      if (home === undefined) throw new Error('loader home was not assigned')
      await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'none' })
      await ctx.plugin(SqliteSessionQueryEngine, {
        path: join(home, 'query.sqlite'),
        openAt: 'startup',
      })
    },
  }
  const scripted = {
    name: 'scripted-model',
    inject: ['llm', 'tools'],
    apply(ctx: Context) {
      ctx.llm.registerAdapter(['mock'], adapter)
      registerTools(ctx)
    },
  }
  const modules = new Map<string, object>([
    ['host-stubs', stubs],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['durable-services', durable],
    ['scripted-model', scripted],
    ['@deepseek-ai/dsh-api-session-controller', SessionController],
  ])
  context.loader.internal = {
    version: 'v2',
    import(specifier: string) {
      const found = modules.get(specifier)
      if (found === undefined) return Promise.reject(new Error(`unexpected Loader import: ${specifier}`))
      return Promise.resolve(found)
    },
  }
  await context.plugin(Storage)
  applyStorageJson(context, { root: join(root, 'storages') })
  const facility = new DomainFacility(context, { backend: 'json', routes: {} })
  context.storage.mount('domain', facility)
  context.provide('storageDomain', facility)
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  if ([...context.loader.entries()].some(entry => entry.fiber === undefined && !entry.disabled)) throw new Error('Loader composition has pending entries')
  if (context.get('sessionController') === undefined) throw new Error('Controller missing')
  return context
}

