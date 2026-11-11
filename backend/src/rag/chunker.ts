import { parse } from "@babel/parser"
import { Document } from "@langchain/core/documents"

const MAX_CHUNK_CHARS = 3000
const JS_TS_EXTS = new Set([".js", ".jsx", ".ts", ".tsx"])

function parseSource(content: string, ext: string) {
    const isTypeScript = ext === ".ts" || ext === ".tsx"
    const isJSX = ext === ".jsx" || ext === ".tsx"
    return parse(content, {
        sourceType: "unambiguous", errorRecovery: true,
        plugins: [
            ...(isTypeScript ? ["typescript"] : []), ...(isJSX ? ["jsx"] : []),
            "decorators-legacy", "classProperties", "classPrivateProperties",
            "classPrivateMethods", "importMeta", "topLevelAwait", "dynamicImport"
        ] as any
    })
}

function characterChunks(content: string, filePath: string): Document[] {
    const lines = content.split("\n")
    const chunks: string[] = []
    let current = ""
    for (const line of lines) {
        if (current && current.length + line.length + 1 > MAX_CHUNK_CHARS) {
            chunks.push(current)
            current = ""
        }
        current += `${line}\n`
    }
    if (current.trim()) chunks.push(current)
    return chunks.map((pageContent, chunkIndex) => new Document({
        pageContent: pageContent.trimEnd(), metadata: { filePath, chunkIndex, chunkType: "character", charCount: pageContent.length }
    }))
}

export function chunkFileByAST(content: string, filePath: string, ext: string): Document[] {
    if (!JS_TS_EXTS.has(ext)) return characterChunks(content, filePath)
    let ast: any
    try { ast = parseSource(content, ext) } catch { return characterChunks(content, filePath) }

    const body = ast.program?.body ?? []
    const raw: Array<{ label: string; source: string; line: number }> = []
    let imports: any[] = []
    const flushImports = () => {
        if (!imports.length) return
        raw.push({ label: "imports", source: imports.map((node) => content.slice(node.start, node.end)).join("\n"), line: imports[0].loc?.start?.line ?? 1 })
        imports = []
    }

    for (const node of body) {
        if (node.type === "ImportDeclaration") { imports.push(node); continue }
        flushImports()
        const source = content.slice(node.start, node.end).trim()
        if (source) raw.push({ label: node.type, source, line: node.loc?.start?.line ?? 1 })
    }
    flushImports()
    if (!raw.length) return characterChunks(content, filePath)

    return raw.flatMap((chunk, index) => {
        const source = chunk.source
        if (source.length <= MAX_CHUNK_CHARS || chunk.label !== "imports") {
            return [new Document({ pageContent: source, metadata: { filePath, chunkIndex: index, chunkLabel: chunk.label, startLine: chunk.line, chunkType: "ast" } })]
        }
        return characterChunks(source, filePath).map((doc, childIndex) => new Document({
            pageContent: doc.pageContent,
            metadata: { filePath, ...doc.metadata, chunkIndex: index, childIndex, chunkLabel: chunk.label, startLine: chunk.line, chunkType: "ast" }
        }))
    })
}
