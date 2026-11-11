/**
 * Smoke-test all current LangChain tool functionalities.
 * Run from backend/: npx ts-node scripts/smoke-test-tools.ts
 */
import {
    readFileTool,
    writeFileTool,
    editFileTool,
    fileTreeTool,
    listDirTool,
    lsTool,
    searchFileTool,
    safePath
} from "../src/tools/fileSystem"
import { bashTool } from "../src/tools/bash"
import { astAnalyzeTool } from "../src/tools/ast"
import { gitDiffTool, gitLogTool, gitStatusTool } from "../src/tools/git"
import {
    buildImportGraphTool,
    queryImportGraphTool,
    impactAnalysisTool
} from "../src/tools/importGraph"
import {
    readAgentIndexTool,
    updateAgentIndexTool,
    readAgentModuleTool,
    writeAgentModuleTool,
    listAgentModulesTool,
    readEmbeddingsIndexTool,
    recordEmbeddings
} from "../src/tools/projectContextBuilder"

type Result = { name: string; ok: boolean; detail: string }

const results: Result[] = []

function pass(name: string, detail: string) {
    results.push({ name, ok: true, detail: clip(detail) })
    console.log(`PASS  ${name}`)
}

function fail(name: string, detail: string) {
    results.push({ name, ok: false, detail: clip(detail) })
    console.log(`FAIL  ${name}`)
    console.log(`      ${clip(detail).split("\n")[0]}`)
}

function clip(value: string, max = 400) {
    const text = String(value ?? "")
    return text.length > max ? `${text.slice(0, max)}...` : text
}

function assertOk(output: string) {
    const lower = output.toLowerCase()
    if (lower.includes("[error]") || lower.includes("[blocked]") || lower.includes("[failed]") || lower.startsWith("error ")) {
        throw new Error(output)
    }
    return output
}

async function run(name: string, fn: () => Promise<string>, expect?: (out: string) => void) {
    try {
        const out = await fn()
        if (expect) expect(out)
        else assertOk(out)
        pass(name, out)
    } catch (err: any) {
        fail(name, err?.message || String(err))
    }
}

async function main() {
    console.log("=== Coding-agent tool smoke tests ===\n")

    // --- fileSystem ---
    await run("write_file", async () => {
        const out = await writeFileTool.invoke({
            file_path: "notes/hello.txt",
            content: "line1\nline2\nUNIQUE_MARKER\nline4\n"
        })
        if (!String(out).includes("Written:")) throw new Error(String(out))
        return String(out)
    })

    await run("read_file", async () => {
        const out = await readFileTool.invoke({ file_path: "notes/hello.txt", start_line: 1, end_line: 2 })
        if (!String(out).includes("1 | line1")) throw new Error(String(out))
        return String(out)
    })

    await run("edit_file", async () => {
        const out = await editFileTool.invoke({
            file_path: "notes/hello.txt",
            old_str: "UNIQUE_MARKER",
            new_str: "EDITED_MARKER"
        })
        if (!String(out).includes("[INFO] Edited")) throw new Error(String(out))
        return String(out)
    })

    await run("safePath_blocks_traversal", async () => {
        try {
            safePath("../outside.txt")
            throw new Error("expected path traversal to throw")
        } catch (err: any) {
            if (!String(err.message).includes("BLOCKED")) throw err
            return String(err.message)
        }
    }, (out) => {
        if (!out.includes("BLOCKED")) throw new Error(out)
    })

    await run("file_tree", async () => {
        const out = await fileTreeTool.invoke({})
        if (!String(out).includes("src/")) throw new Error(String(out))
        return String(out)
    })

    await run("list_dir", async () => {
        const out = await listDirTool.invoke({ directory: "src" })
        if (!String(out).includes("math.ts")) throw new Error(String(out))
        return String(out)
    })

    await run("ls", async () => {
        const out = await lsTool.invoke({ pattern: "**/*.ts" })
        const text = String(out).replace(/\\/g, "/")
        if (!text.includes("src/index.ts") && !text.includes("index.ts")) throw new Error(String(out))
        return String(out)
    })

    await run("search_file", async () => {
        const out = await searchFileTool.invoke({ query: "multiply", file_patterns: "**/*.ts" })
        if (!String(out).includes("[SEARCH]")) throw new Error(String(out))
        return String(out)
    })

    // --- bash ---
    await run("bash_echo", async () => {
        const out = await bashTool.invoke({ command: "echo smoke-ok" })
        if (!String(out).includes("smoke-ok")) throw new Error(String(out))
        return String(out)
    })

    await run("bash_blocks_dangerous", async () => {
        const out = await bashTool.invoke({ command: "rm -rf /" })
        if (!String(out).includes("[BLOCKED]")) throw new Error(`expected block, got: ${out}`)
        return String(out)
    }, (out) => {
        if (!out.includes("[BLOCKED]")) throw new Error(out)
    })

    // --- ast ---
    await run("ast_analyze", async () => {
        const out = await astAnalyzeTool.invoke({ file_path: "src/math.ts" })
        if (!String(out).includes("## Functions") || !String(out).includes("add(")) throw new Error(String(out))
        return String(out)
    })

    // --- git (uses public/aent-working-dir/human-in-loop) ---
    await run("git_status", async () => {
        const out = await gitStatusTool.invoke({})
        if (String(out).toLowerCase().includes("git status error")) throw new Error(String(out))
        return String(out)
    })

    await run("git_log", async () => {
        const out = await gitLogTool.invoke({ limit: 5 })
        if (!String(out).includes("Recent commits")) throw new Error(String(out))
        return String(out)
    })

    await run("git_diff", async () => {
        const out = await gitDiffTool.invoke({})
        if (String(out).toLowerCase().includes("git diff error")) throw new Error(String(out))
        return String(out)
    })

    // --- import graph ---
    await run("build_import_graph", async () => {
        const out = await buildImportGraphTool.invoke({ directory: "src" })
        if (!String(out).includes("[DONE] Import graph built")) throw new Error(String(out))
        return String(out)
    })

    await run("query_import_graph", async () => {
        const out = await queryImportGraphTool.invoke({ file_path: "src/math.ts", direction: "both", depth: 2 })
        if (!String(out).includes("[FILE]")) throw new Error(String(out))
        return String(out)
    })

    await run("impact_analysis", async () => {
        const out = await impactAnalysisTool.invoke({ file_path: "src/math.ts" })
        if (!String(out).includes("[IMPACT]")) throw new Error(String(out))
        return String(out)
    })

    // --- agent memory / project context ---
    await run("read_agent_index", async () => {
        const out = await readAgentIndexTool.invoke({})
        if (!String(out).includes(".agent/index.md")) throw new Error(String(out))
        return String(out)
    })

    await run("update_agent_index", async () => {
        const out = await updateAgentIndexTool.invoke({
            section: "Project Overview",
            content: "Smoke-test sample TypeScript project."
        })
        if (!String(out).includes("[DONE]")) throw new Error(String(out))
        return String(out)
    })

    await run("write_agent_module", async () => {
        const out = await writeAgentModuleTool.invoke({
            module_name: "math",
            section: "Overview",
            content: "Basic arithmetic helpers."
        })
        if (!String(out).includes("[DONE]")) throw new Error(String(out))
        return String(out)
    })

    await run("read_agent_module", async () => {
        const out = await readAgentModuleTool.invoke({ module_name: "math" })
        if (!String(out).includes("Basic arithmetic helpers")) throw new Error(String(out))
        return String(out)
    })

    await run("list_agent_modules", async () => {
        const out = await listAgentModulesTool.invoke({})
        if (!String(out).includes("[MODULE] math")) throw new Error(String(out))
        return String(out)
    })

    await run("record_and_read_embeddings", async () => {
        await recordEmbeddings({ "src/math.ts": 2, "src/index.ts": 1 })
        const out = await readEmbeddingsIndexTool.invoke({})
        if (!String(out).includes("src/math.ts")) throw new Error(String(out))
        return String(out)
    })

    const passed = results.filter((r) => r.ok).length
    const failed = results.filter((r) => !r.ok).length
    console.log("\n=== Summary ===")
    console.log(`Passed: ${passed}`)
    console.log(`Failed: ${failed}`)
    console.log(`Total:  ${results.length}`)
    if (failed) {
        console.log("\nFailures:")
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
