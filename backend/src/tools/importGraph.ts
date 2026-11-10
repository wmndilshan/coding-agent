import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { parse } from "@babel/parser"
import fs from "fs/promises"
import path from "path"
import { glob } from "glob"
import { WORKING_DIR, safePath } from "./fileSystem"

const AGENT_DIR = path.join(WORKING_DIR, ".agent")
const GRAPH_PATH = path.join(AGENT_DIR, "graph.json")
const SOURCE_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"]
const IGNORED_DIRS = ["node_modules", ".git", "dist", "build", ".agent", "coverage", "out"]

type GraphNode = {
    imports: string[]
    importedBy: string[]
    unresolvedImports: string[]
}

type ImportGraph = Record<string, GraphNode>

type GraphSummary = {
    totalFiles: number
    entryPoints: string[]
    isolated: string[]
    mostImported: Array<{ file: string; importedBy: number }>
    unresolvedImportCount: number
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "")
}

function resolveImport(fromFile: string, importPath: string): string | null {
    if (!importPath.startsWith(".")) return null
    return normalizePath(path.join(path.dirname(fromFile), importPath))
}

function resolveToActualFile(importedPath: string, allFiles: Set<string>): string | null {
    const normalized = normalizePath(importedPath)
    const withoutExtension = SOURCE_EXTENSIONS.includes(path.extname(normalized))
        ? normalized.slice(0, -path.extname(normalized).length)
        : normalized
    const candidates = [normalized, ...SOURCE_EXTENSIONS.map((extension) => `${withoutExtension}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => `${withoutExtension}/index${extension}`)]

    for (const candidate of candidates) {
        const normalizedCandidate = normalizePath(candidate)
        if (allFiles.has(normalizedCandidate)) return normalizedCandidate
    }
    return null
}

function extractImports(content: string, extension: string): string[] {
    const isTypeScript = [".ts", ".tsx"].includes(extension)
    const isJSX = [".jsx", ".tsx"].includes(extension)
    try {
        const ast = parse(content, {
            sourceType: "unambiguous",
            errorRecovery: true,
            plugins: [
                ...(isTypeScript ? ["typescript"] : []),
                ...(isJSX ? ["jsx"] : []),
                "decorators-legacy",
                "classProperties",
                "classPrivateProperties",
                "classPrivateMethods",
                "importMeta",
                "topLevelAwait",
                "dynamicImport"
            ] as any
        })
        const imports: string[] = []
        const add = (value: unknown) => {
            if (typeof value === "string" && !imports.includes(value)) imports.push(value)
        }

        for (const node of ast.program.body as any[]) {
            if (node.type === "ImportDeclaration") add(node.source?.value)
            if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) add(node.source.value)
            if (node.type !== "ExpressionStatement") continue

            const expression = node.expression
            if (expression?.type !== "CallExpression") continue
            const argument = expression.arguments?.[0]
            if (argument?.type !== "StringLiteral") continue
            if (expression.callee?.type === "Identifier" && expression.callee.name === "require") add(argument.value)
            if (expression.callee?.type === "Import") add(argument.value)
        }
        return imports
    } catch {
        return []
    }
}

async function buildGraph(files: string[]): Promise<ImportGraph> {
    const normalizedFiles = [...new Set(files.map(normalizePath))].sort()
    const fileSet = new Set(normalizedFiles)
    const graph: ImportGraph = {}
    for (const file of normalizedFiles) graph[file] = { imports: [], importedBy: [], unresolvedImports: [] }

    for (const file of normalizedFiles) {
        let content: string
        try {
            content = await fs.readFile(safePath(file), "utf-8")
        } catch {
            continue
        }

        for (const imported of extractImports(content, path.extname(file).toLowerCase())) {
            const relativePath = resolveImport(file, imported)
            if (!relativePath) {
                graph[file].unresolvedImports.push(imported)
                continue
            }

            const actualFile = resolveToActualFile(relativePath, fileSet)
            if (!actualFile) {
                graph[file].unresolvedImports.push(imported)
                continue
            }

            if (!graph[file].imports.includes(actualFile)) graph[file].imports.push(actualFile)
            if (!graph[actualFile].importedBy.includes(file)) graph[actualFile].importedBy.push(file)
        }
    }
    return graph
}

function analyzeGraph(graph: ImportGraph): GraphSummary {
    const entryPoints: string[] = []
    const isolated: string[] = []
    const mostImported: Array<{ file: string; importedBy: number }> = []
    let unresolvedImportCount = 0

    for (const [file, node] of Object.entries(graph)) {
        if (node.importedBy.length === 0 && node.imports.length > 0) entryPoints.push(file)
        if (node.importedBy.length === 0 && node.imports.length === 0) isolated.push(file)
        if (node.importedBy.length > 0) mostImported.push({ file, importedBy: node.importedBy.length })
        unresolvedImportCount += node.unresolvedImports.length
    }

    mostImported.sort((a, b) => b.importedBy - a.importedBy || a.file.localeCompare(b.file))
    return { totalFiles: Object.keys(graph).length, entryPoints, isolated, mostImported: mostImported.slice(0, 10), unresolvedImportCount }
}

function findGraphFile(graph: ImportGraph, filePath: string): string | undefined {
    const query = normalizePath(filePath)
    if (graph[query]) return query
    return Object.keys(graph).find((file) => file === query || file.endsWith(`/${query}`) || path.basename(file) === query)
}

function relatedFiles(graph: ImportGraph, start: string, relation: "imports" | "importedBy", depth: number): Map<string, number> {
    const result = new Map<string, number>()
    let current = [start]
    for (let level = 1; level <= depth && current.length; level++) {
        const next: string[] = []
        for (const file of current) {
            for (const related of graph[file]?.[relation] ?? []) {
                if (related === start || result.has(related)) continue
                result.set(related, level)
                next.push(related)
            }
        }
        current = next
    }
    return result
}

async function readSavedGraph(): Promise<{ graph: ImportGraph; summary?: GraphSummary; builtAt?: string }> {
    return JSON.parse(await fs.readFile(GRAPH_PATH, "utf-8"))
}

export const buildImportGraphTool = tool(
    async ({ directory, file_pattern }) => {
        try {
            const base = directory ? safePath(directory) : WORKING_DIR
            const pattern = file_pattern ?? "**/*.{js,ts,jsx,tsx}"
            const files = await glob(pattern, {
                cwd: base,
                ignore: IGNORED_DIRS.flatMap((dir) => [`**/${dir}/**`]).concat(["**/*.min.js"]),
                nodir: true,
                absolute: false
            })
            const relativeDirectory = directory ? normalizePath(path.relative(WORKING_DIR, base)) : ""
            const realFiles = files.map((file) => normalizePath(relativeDirectory ? path.join(relativeDirectory, file) : file))
            if (!realFiles.length) return `No JavaScript or TypeScript files found matching "${pattern}".`

            const graph = await buildGraph(realFiles)
            const summary = analyzeGraph(graph)
            await fs.mkdir(AGENT_DIR, { recursive: true })
            await fs.writeFile(GRAPH_PATH, JSON.stringify({ graph, summary, builtAt: new Date().toISOString() }, null, 2), "utf-8")

            const lines = [
                `[DONE] Import graph built - ${summary.totalFiles} files`,
                `[INFO] Entry points (${summary.entryPoints.length}): ${summary.entryPoints.slice(0, 10).join(", ") || "none"}`,
                `[INFO] Most imported: ${summary.mostImported.slice(0, 5).map((item) => `${item.file} (${item.importedBy})`).join(", ") || "none"}`,
                `[INFO] Unresolved imports: ${summary.unresolvedImportCount}`
            ]
            if (summary.isolated.length) lines.push(`[INFO] Isolated files (${summary.isolated.length}): ${summary.isolated.slice(0, 10).join(", ")}`)
            lines.push("[SAVE] Saved to .agent/graph.json")
            return lines.join("\n")
        } catch (err: any) {
            return `[ERROR] Import graph error: ${err.message}`
        }
    },
    {
        name: "build_import_graph",
        description: "Build and save a bidirectional local import graph for JavaScript and TypeScript files. Reports entry points, highly imported files, isolated files, unresolved relative imports, and saves the result to .agent/graph.json.",
        schema: z.object({
            directory: z.string().optional().describe("Subdirectory to scan relative to the working directory; omit to scan the full project"),
            file_pattern: z.string().optional().describe("Glob pattern for source files; defaults to **/*.{js,ts,jsx,tsx}")
        })
    }
)

export const queryImportGraphTool = tool(
    async ({ file_path, direction, depth }) => {
        try {
            const { graph } = await readSavedGraph()
            const target = findGraphFile(graph, file_path)
            if (!target) return `[WARN] "${file_path}" not found in the saved graph. Run build_import_graph first.`

            const selectedDirection = direction ?? "both"
            const maxDepth = depth ?? 1
            const lines = [`[FILE] ${target}`]
            if (selectedDirection === "imports" || selectedDirection === "both") {
                const imports = relatedFiles(graph, target, "imports", maxDepth)
                lines.push(`\nImports (${graph[target].imports.length} direct, depth ${maxDepth}):`)
                lines.push(...(imports.size ? [...imports].map(([file, level]) => `  ${file} (depth ${level})`) : ["  none"]))
            }
            if (selectedDirection === "importedBy" || selectedDirection === "both") {
                const importedBy = relatedFiles(graph, target, "importedBy", maxDepth)
                lines.push(`\nImported by (${graph[target].importedBy.length} direct, depth ${maxDepth}):`)
                lines.push(...(importedBy.size ? [...importedBy].map(([file, level]) => `  ${file} (depth ${level})`) : ["  none"]))
            }
            if (graph[target].unresolvedImports.length) lines.push(`\nUnresolved relative imports: ${graph[target].unresolvedImports.join(", ")}`)
            return lines.join("\n")
        } catch (err: any) {
            return err.code === "ENOENT" ? "[WARN] No saved import graph. Run build_import_graph first." : `[ERROR] Import graph query failed: ${err.message}`
        }
    },
    {
        name: "query_import_graph",
        description: "Query a saved import graph for a file's imports, reverse dependents, or both up to a chosen traversal depth.",
        schema: z.object({
            file_path: z.string().min(1).describe("Project-relative file path or unique file name to query"),
            direction: z.enum(["imports", "importedBy", "both"]).optional().describe("Relationship direction; defaults to both"),
            depth: z.number().int().min(1).max(20).optional().describe("Maximum relationship depth; defaults to 1")
        })
    }
)

export const impactAnalysisTool = tool(
    async ({ file_path }) => {
        try {
            const { graph } = await readSavedGraph()
            const target = findGraphFile(graph, file_path)
            if (!target) return `[WARN] "${file_path}" not found in the saved graph. Run build_import_graph first.`

            const impacted = relatedFiles(graph, target, "importedBy", 20)
            const levels = new Map<number, string[]>()
            for (const [file, level] of impacted) levels.set(level, [...(levels.get(level) ?? []), file])
            const lines = [`[IMPACT] ${target}`, `Direct dependents: ${graph[target].importedBy.length}`, `Total affected files: ${impacted.size}`]
            for (const [level, files] of levels) lines.push(`\nDepth ${level} (${files.length}):\n${files.map((file) => `  ${file}`).join("\n")}`)
            return lines.join("\n")
        } catch (err: any) {
            return err.code === "ENOENT" ? "[WARN] No saved import graph. Run build_import_graph first." : `[ERROR] Impact analysis failed: ${err.message}`
        }
    },
    {
        name: "impact_analysis",
        description: "Show the files that may be affected by changing a target file, following reverse local imports through the saved graph.",
        schema: z.object({ file_path: z.string().min(1).describe("Project-relative file path or unique file name to analyze") })
    }
)

// Keep the original misspelled export as a compatibility alias.
export const impactAnallysisTool = impactAnalysisTool

export const graphTools = [buildImportGraphTool, queryImportGraphTool, impactAnalysisTool]

