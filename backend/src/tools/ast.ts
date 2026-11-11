import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { parse } from "@babel/parser"
import fs from "fs/promises"
import path from "path"
import { safePath } from "./fileSystem"

type Structure = {
    imports: Array<{ from: string; specifiers: string[] }>
    exports: string[]
    functions: Array<{ name: string; params: string[]; async: boolean; generator: boolean; returnType?: string; exported: boolean; line: number }>
    classes: Array<{ name: string; superClass?: string; exported: boolean; line: number; methods: Array<{ name: string; kind: string; static: boolean; abstract: boolean; access: string }> }>
    types: Array<{ kind: string; name: string; members?: string[]; line: number }>
    variables: Array<{ kind: string; name: string; exported: boolean; line: number }>
}

function typeName(node: any): string {
    if (!node) return ""
    if (node.type === "Identifier") return node.name
    if (node.type === "PrivateName") return `#${node.id?.name ?? "?"}`
    if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node.value)
    if (node.type === "ThisExpression") return "this"
    if (node.type === "MemberExpression") return `${typeName(node.object)}.${typeName(node.property)}`
    return node.type ?? "?"
}

function annotationName(node: any): string | undefined {
    if (!node) return undefined
    if (node.typeAnnotation) return annotationName(node.typeAnnotation)
    if (node.type === "TSTypeAnnotation") return annotationName(node.typeAnnotation)
    if (node.type === "TSTypeReference") {
        const name = typeName(node.typeName)
        const args = (node.typeParameters?.params ?? node.typeArguments?.params)?.map(annotationName).filter(Boolean)
        return args?.length ? `${name}<${args.join(", ")}>` : name
    }
    if (node.type === "TSArrayType") return `${annotationName(node.elementType) ?? "?"}[]`
    if (node.type === "TSUnionType") return node.types.map(annotationName).join(" | ")
    if (node.type === "TSLiteralType") return typeName(node.literal)
    if (node.type === "TSFunctionType") return "function"
    if (node.type === "TSStringKeyword") return "string"
    if (node.type === "TSNumberKeyword") return "number"
    if (node.type === "TSBooleanKeyword") return "boolean"
    if (node.type === "TSAnyKeyword") return "any"
    if (node.type === "TSVoidKeyword") return "void"
    return node.type?.replace(/^TS/, "") ?? "?"
}

function formatParams(params: any[]): string[] {
    return params.map((param) => {
        switch (param.type) {
            case "Identifier": return `${param.name}${param.typeAnnotation ? `: ${annotationName(param.typeAnnotation)}` : ""}`
            case "AssignmentPattern": return `${formatParams([param.left])[0]} = ...`
            case "RestElement": return `...${formatParams([param.argument])[0]}`
            case "ObjectPattern": return "{...}"
            case "ArrayPattern": return "[...]"
            case "TSParameterProperty": return formatParams([param.parameter])[0]
            default: return "?"
        }
    })
}

function declarationNames(pattern: any): string[] {
    if (!pattern) return []
    if (pattern.type === "Identifier") return [pattern.name]
    if (pattern.type === "RestElement" || pattern.type === "AssignmentPattern") return declarationNames(pattern.argument ?? pattern.left)
    if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((property: any) => declarationNames(property.value ?? property.argument))
    if (pattern.type === "ArrayPattern") return pattern.elements.flatMap((element: any) => declarationNames(element))
    return []
}

function extractStructure(ast: any): Structure {
    const result: Structure = { imports: [], exports: [], functions: [], classes: [], types: [], variables: [] }
    const visited = new WeakSet<object>()
    const addExport = (name: string) => { if (name && !result.exports.includes(name)) result.exports.push(name) }

    const visit = (node: any, topLevel = false, exported = false, nameOverride?: string): void => {
        if (!node || typeof node !== "object" || visited.has(node)) return
        visited.add(node)

        switch (node.type) {
            case "ImportDeclaration":
                result.imports.push({
                    from: node.source.value,
                    specifiers: node.specifiers.map((specifier: any) => {
                        if (specifier.type === "ImportDefaultSpecifier") return `default as ${specifier.local.name}`
                        if (specifier.type === "ImportNamespaceSpecifier") return `* as ${specifier.local.name}`
                        const imported = typeName(specifier.imported)
                        return imported === specifier.local.name ? imported : `${imported} as ${specifier.local.name}`
                    })
                })
                break
            case "ExportDefaultDeclaration":
                addExport("default")
                visit(node.declaration, topLevel, true)
                return
            case "ExportNamedDeclaration":
                if (node.declaration) visit(node.declaration, topLevel, true)
                for (const specifier of node.specifiers ?? []) addExport(typeName(specifier.exported))
                if (node.source) addExport(`from ${JSON.stringify(node.source.value)}`)
                return
            case "ExportAllDeclaration":
                addExport(`* from ${JSON.stringify(node.source.value)}`)
                return
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
                result.functions.push({
                    name: nameOverride ?? node.id?.name ?? "anonymous",
                    params: formatParams(node.params ?? []),
                    async: Boolean(node.async),
                    generator: Boolean(node.generator),
                    returnType: annotationName(node.returnType),
                    exported,
                    line: node.loc?.start.line ?? 0
                })
                break
            case "ClassDeclaration":
            case "ClassExpression":
                result.classes.push({
                    name: node.id?.name ?? "anonymous",
                    superClass: typeName(node.superClass) || undefined,
                    exported,
                    line: node.loc?.start.line ?? 0,
                    methods: (node.body?.body ?? [])
                        .filter((member: any) => ["ClassMethod", "ClassPrivateMethod", "ObjectMethod"].includes(member.type))
                        .map((method: any) => ({ name: typeName(method.key), kind: method.kind ?? "method", static: Boolean(method.static), abstract: Boolean(method.abstract), access: method.access ?? "public" }))
                })
                break
            case "TSInterfaceDeclaration":
                result.types.push({ kind: "interface", name: node.id.name, members: (node.body?.body ?? []).map((member: any) => typeName(member.key)), line: node.loc?.start.line ?? 0 })
                break
            case "TSTypeAliasDeclaration":
                result.types.push({ kind: "type", name: node.id.name, line: node.loc?.start.line ?? 0 })
                break
            case "TSEnumDeclaration":
                result.types.push({ kind: "enum", name: node.id.name, members: (node.members ?? []).map((member: any) => typeName(member.id)), line: node.loc?.start.line ?? 0 })
                break
            case "VariableDeclaration":
                if (topLevel) {
                    for (const declaration of node.declarations ?? []) {
                        const names = declarationNames(declaration.id)
                        for (const name of names) result.variables.push({ kind: node.kind, name, exported, line: declaration.loc?.start.line ?? node.loc?.start.line ?? 0 })
                        if (["ArrowFunctionExpression", "FunctionExpression"].includes(declaration.init?.type)) {
                            visit(declaration.init, false, exported, names[0] ?? "anonymous")
                        }
                    }
                }
                break
        }

        for (const [key, value] of Object.entries(node)) {
            if (["loc", "start", "end", "tokens", "comments"].includes(key)) continue
            if (Array.isArray(value)) value.forEach((child) => visit(child))
            else visit(value)
        }
    }

    for (const node of ast.program.body) visit(node, true)
    return result
}

function renderStructure(filePath: string, structure: Structure): string {
    const lines = [`# AST - ${filePath}`]
    if (structure.imports.length) {
        lines.push("", "## Imports")
        for (const item of structure.imports) lines.push(`  from "${item.from}": ${item.specifiers.join(", ") || "side effect"}`)
    }
    if (structure.functions.length) {
        lines.push("", "## Functions")
        for (const fn of structure.functions) {
            const flags = [fn.async && "async", fn.generator && "generator", fn.exported && "export"].filter(Boolean).join(", ")
            const suffix = [fn.returnType && `-> ${fn.returnType}`, flags && `[${flags}]`].filter(Boolean).join(" ")
            lines.push(`  ${fn.name}(${fn.params.join(", ")})${suffix ? ` ${suffix}` : ""}  line ${fn.line}`)
        }
    }
    if (structure.classes.length) {
        lines.push("", "## Classes")
        for (const cls of structure.classes) {
            lines.push(`  ${cls.name}${cls.superClass ? ` extends ${cls.superClass}` : ""}${cls.exported ? " [export]" : ""}  line ${cls.line}`)
            for (const method of cls.methods) {
                const flags = [method.static && "static", method.abstract && "abstract", method.access !== "public" && method.access].filter(Boolean).join(" ")
                lines.push(`    [${method.kind}] ${flags ? `${flags} ` : ""}${method.name}`)
            }
        }
    }
    if (structure.types.length) {
        lines.push("", "## Types / Interfaces / Enums")
        for (const type of structure.types) lines.push(`  [${type.kind}] ${type.name}${type.members?.length ? ` { ${type.members.join(", ")} }` : ""}  line ${type.line}`)
    }
    if (structure.variables.length) {
        lines.push("", "## Top-level variables")
        for (const variable of structure.variables) lines.push(`  ${variable.kind} ${variable.name}${variable.exported ? " [export]" : ""}  line ${variable.line}`)
    }
    if (structure.exports.length) lines.push("", "## Exports", `  ${structure.exports.join(", ")}`)
    return lines.join("\n")
}

export const astAnalyzeTool = tool(
    async ({ file_path }) => {
        try {
            const fullPath = safePath(file_path)
            const content = await fs.readFile(fullPath, "utf-8")
            const extension = path.extname(file_path).toLowerCase()
            const isTypeScript = [".ts", ".tsx"].includes(extension)
            const isJSX = [".jsx", ".tsx"].includes(extension)
            const plugins: any[] = [
                ...(isTypeScript ? ["typescript"] : []),
                ...(isJSX ? ["jsx"] : []),
                "decorators-legacy", "classProperties", "classPrivateProperties", "classPrivateMethods", "topLevelAwait"
            ]
            const ast = parse(content, { sourceType: "unambiguous", plugins })
            return renderStructure(file_path, extractStructure(ast))
        } catch (err: any) {
            return `[ERROR] AST analysis failed for ${file_path}: ${err.message}`
        }
    },
    {
        name: "ast_analyze",
        description: "Parse a JS/TS/JSX/TSX file with Babel and extract imports, exports, functions, classes, TypeScript types, and top-level variables.",
        schema: z.object({ file_path: z.string().min(1).describe("Path to a JS/TS/JSX/TSX file relative to the working directory") })
    }
)


export const selectAstTools = {
    "ast_analyze": astAnalyzeTool
} as Record<string, any>