import type { Formula, Scalar, ShownView, ViewFailure, ViewNode } from '../contracts.ts'

export declare const CHART_KINDS: readonly string[]
export declare const VIEW_BYTE_LIMIT: number
export declare const FORMULA_FUNCTIONS: readonly string[]
export declare function isName(value: unknown): value is string
export declare function show(value: unknown): string
export declare function asText(value: unknown): string
export declare function checkShownView(title: unknown, sent: unknown): ShownView | ViewFailure
export declare function normalizeView(value: unknown): unknown
export declare function validateView(view: unknown): { ok: true; interactive: boolean } | { ok: false; error: string }
export declare function viewBytes(title: unknown, view: unknown): number
export declare function viewInputs(view: ViewNode): ViewNode[]
export declare function inputDefault(node: ViewNode): unknown
export declare function choiceValue(option: { label?: string; value?: Scalar } | undefined): Scalar | undefined
export declare function viewScope(view: ViewNode, values?: Record<string, unknown>): (name: string) => unknown
export declare function resolve(value: unknown, lookup: (name: string) => unknown, fallback?: unknown): unknown
export declare function validateViewAnswer(view: ViewNode, action: unknown, values: unknown): Record<string, unknown> & { error?: string }
export declare function viewSummary(view: ViewNode): string
export declare function inputsSummary(view: ViewNode, values: unknown): string
export declare function hasInputs(view: ViewNode): boolean
export declare function isFormula(value: unknown): value is Formula
export type FormulaTree = { type: string; [key: string]: unknown }
export declare function compileFormula(source: unknown): { tree: FormulaTree; names: string[]; error?: undefined } | { error: string; tree?: undefined; names?: undefined }
export declare function createScope(inputs: Map<string, unknown>, lets: Map<string, FormulaTree>): (name: string) => unknown
export declare function evaluate(tree: FormulaTree, lookup: (name: string) => unknown): { value: unknown; error?: undefined } | { error: string; value?: undefined }
