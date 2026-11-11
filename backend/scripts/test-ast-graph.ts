/**
 * Focused correctness checks for AST + import-graph tools.
 * Run: npx ts-node scripts/test-ast-graph.ts
 */
import fs from "fs/promises"
import path from "path"
import { astAnalyzeTool } from "../src/tools/ast"
import {
    buildImportGraphTool,
    queryImportGraphTool,
    impactAnalysisTool
} from "../src/tools/importGraph"
import { WORKING_DIR } from "../src/tools/fileSystem"

type Case = { name: string; ok: boolean; detail: string }

const results: Case[] = []

function record(name: string, ok: boolean, detail: string) {
    results.push({ name, ok, detail })
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
    if (!ok) console.log(`      ${detail.split("\n")[0]}`)
    else {
        const preview = detail.split("\n").slice(0, 8).join("\n")
        console.log(preview)
        console.log("---")
    }
}

async function run(name: string, fn: () => Promise<string>, pred: (out: string) => boolean) {
    try {
        const out = String(await fn())
        if (!pred(out)) throw new Error(out)
        record(name, true, out)
    } catch (err: any) {
        record(name, false, err?.message || String(err))
    }
}

async function main() {
    console.log("=== AST + Import Graph correctness ===\n")
    console.log(`WORKING_DIR: ${WORKING_DIR}\n`)

    await run(
        "ast_analyze math.ts extracts exported functions",
        () => astAnalyzeTool.invoke({ file_path: "src/math.ts" }),
        (o) =>
            o.includes("# AST - src/math.ts") &&
            o.includes("## Functions") &&
            o.includes("add(a: number, b: number)") &&
            o.includes("multiply(a: number, b: number)") &&
            o.includes("-> number") &&
            o.includes("[export]")
    )

    await run(
        "ast_analyze index.ts extracts imports + main",
        () => astAnalyzeTool.invoke({ file_path: "src/index.ts" }),
        (o) =>
            o.includes('from "./math"') &&
            o.includes('from "./utils/greet"') &&
            o.includes("main(") &&
            o.includes("## Imports")
    )

    await run(
        "ast_analyze greet.ts typed params",
        () => astAnalyzeTool.invoke({ file_path: "src/utils/greet.ts" }),
        (o) => o.includes("greet(") && o.includes("name: string") && o.includes("-> string")
    )

    await run(
        "build_import_graph indexes src",
        () => buildImportGraphTool.invoke({ directory: "src" }),
        (o) =>
            o.includes("[DONE] Import graph built") &&
            o.includes("3 files") &&
            o.includes("[SAVE] Saved to .agent/graph.json")
    )

    await run(
        "graph.json has bidirectional edges",
        async () => {
            const graphPath = path.join(WORKING_DIR, ".agent", "graph.json")
            const data = JSON.parse(await fs.readFile(graphPath, "utf-8"))
            const graph = data.graph as Record<string, { imports: string[]; importedBy: string[]; unresolvedImports: string[] }>
            const files = Object.keys(graph).sort()
            const index = graph["src/index.ts"]
            const math = graph["src/math.ts"]
            const greet = graph["src/utils/greet.ts"]
            if (!index || !math || !greet) {
                throw new Error(`missing nodes: ${files.join(", ")}`)
            }
            if (!index.imports.includes("src/math.ts") || !index.imports.includes("src/utils/greet.ts")) {
                throw new Error(`index imports wrong: ${JSON.stringify(index.imports)}`)
            }
            if (!math.importedBy.includes("src/index.ts")) {
                throw new Error(`math importedBy wrong: ${JSON.stringify(math.importedBy)}`)
            }
            if (!greet.importedBy.includes("src/index.ts")) {
                throw new Error(`greet importedBy wrong: ${JSON.stringify(greet.importedBy)}`)
            }
            if (!data.summary?.entryPoints?.includes("src/index.ts")) {
                throw new Error(`entryPoints wrong: ${JSON.stringify(data.summary)}`)
            }
            return JSON.stringify({ files, summary: data.summary, sample: { index, math, greet } }, null, 2)
        },
        () => true
    )

    await run(
        "query_import_graph index imports depth 2",
        () => queryImportGraphTool.invoke({ file_path: "src/index.ts", direction: "imports", depth: 2 }),
        (o) =>
            o.includes("[FILE] src/index.ts") &&
            o.includes("src/math.ts") &&
            o.includes("src/utils/greet.ts")
    )

    await run(
        "query_import_graph math importedBy",
        () => queryImportGraphTool.invoke({ file_path: "src/math.ts", direction: "importedBy", depth: 1 }),
        (o) => o.includes("[FILE] src/math.ts") && o.includes("src/index.ts")
    )

    await run(
        "impact_analysis math affects index",
        () => impactAnalysisTool.invoke({ file_path: "src/math.ts" }),
        (o) =>
            o.includes("[IMPACT] src/math.ts") &&
            o.includes("Direct dependents: 1") &&
            o.includes("src/index.ts")
    )

    await run(
        "impact_analysis greet affects index",
        () => impactAnalysisTool.invoke({ file_path: "src/utils/greet.ts" }),
        (o) => o.includes("[IMPACT]") && o.includes("src/index.ts")
    )

    await run(
        "query missing file returns WARN",
        () => queryImportGraphTool.invoke({ file_path: "src/missing.ts" }),
        (o) => o.includes("[WARN]") && o.includes("not found")
    )

    await run(
        "ast missing file returns ERROR",
        () => astAnalyzeTool.invoke({ file_path: "src/missing.ts" }),
        (o) => o.includes("[ERROR] AST analysis failed")
    )

    const passed = results.filter((r) => r.ok).length
    const failed = results.length - passed
    console.log(`\nResult: ${passed}/${results.length} passed`)
    if (failed) {
        console.log("Failures:")
        for (const r of results.filter((x) => !x.ok)) {
            console.log(`- ${r.name}: ${r.detail.split("\n")[0]}`)
        }
        process.exitCode = 1
    }
}

main().catch((err) => {
    console.error(err)
    process.exitCode = 1
})
