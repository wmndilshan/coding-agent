import { tool } from "@langchain/core/tools"
import { z } from "zod"
import fs from "fs/promises"
import path from "path"
import { WORKING_DIR } from "./fileSystem"

const AGENT_DIR = path.join(WORKING_DIR, ".agent")
const INDEX_PATH = path.join(AGENT_DIR, "index.md")
const MODULES_DIR = path.join(AGENT_DIR, "modules")
const EMBEDDINGS_PATH = path.join(AGENT_DIR, "embeddings.json")

const INDEX_TEMPLATE = `# Agent Memory - Index
> Auto-maintained. Loaded every session. Keep this concise; details go in modules/.
> Last updated: ${new Date().toISOString()}

## Project Overview
*Not yet analyzed*

## Tech Stack
*Not yet detected*

## Entry Points
*Not yet identified*

## Module Map
> List each logical module and its .agent/modules/<name>.md file.
*Not yet mapped*

## Key Conventions
*Not yet observed*

## Known Issues
*None recorded*
`

const MODULE_TEMPLATE = (moduleName: string) => `# Module: ${moduleName}
> Auto-maintained by the coding agent.
> Last updated: ${new Date().toISOString()}

## Overview
*Not yet analyzed*

## Key Files
*Not yet identified*

## Exports & API Surface
*Not yet documented*

## Patterns & Conventions
*Not yet observed*

## Dependencies
*Not yet mapped*

## Known Issues
*None recorded*
`

async function ensureAgentDir(): Promise<void> {
    await fs.mkdir(MODULES_DIR, { recursive: true })
    try {
        await fs.access(INDEX_PATH)
    } catch {
        await fs.writeFile(INDEX_PATH, INDEX_TEMPLATE, "utf-8")
    }
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function touchTimestamp(content: string): string {
    const timestamp = new Date().toISOString()
    const line = `> Last updated: ${timestamp}`
    if (/> Last updated:\s*[^\n]*/.test(content)) return content.replace(/> Last updated:\s*[^\n]*/, line)
    return `${content.trimEnd()}\n${line}\n`
}

function safeSectionReplace(content: string, section: string, newContent: string, append = false): string {
    const normalizedSection = section.trim()
    if (!normalizedSection || normalizedSection.includes("\n")) throw new Error("Section must be a single heading name")

    const regex = new RegExp(`(^## ${escapeRegex(normalizedSection)}\\s*\\n)([\\s\\S]*?)(?=^## |$)`, "m")
    const match = regex.exec(content)
    if (!match) return `${content.trimEnd()}\n\n## ${normalizedSection}\n${newContent.trim()}\n`

    const existing = match[2].trim()
    const replacement = append && existing ? `${existing}\n${newContent.trim()}` : newContent.trim()
    return content.replace(regex, `## ${normalizedSection}\n${replacement}\n`)
}

function modulePath(moduleName: string): string {
    const normalized = moduleName.trim().replace(/\.md$/i, "")
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
        throw new Error("Invalid module name. Use letters, numbers, hyphens, or underscores only.")
    }
    return path.join(MODULES_DIR, `${normalized}.md`)
}

export const readAgentIndexTool = tool(
    async () => {
        try {
            await ensureAgentDir()
            const content = await fs.readFile(INDEX_PATH, "utf-8")
            const files = (await fs.readdir(MODULES_DIR)).filter((file) => file.endsWith(".md")).sort()
            const moduleList = files.length
                ? `\n\n---\nAvailable module files (load with read_agent_module):\n${files.map((file) => `  - ${file.replace(/\.md$/, "")}`).join("\n")}`
                : "\n\n---\nNo module files yet."
            return `[INFO] .agent/index.md\n\n${content}${moduleList}`
        } catch (err: any) {
            return `[ERROR] Could not read agent index: ${err.message}`
        }
    },
    {
        name: "read_agent_index",
        description: "Read the top-level project memory at .agent/index.md, including the project overview, tech stack, entry points, module map, conventions, and known issues. Use at session start.",
        schema: z.object({})
    }
)

export const updateAgentIndexTool = tool(
    async ({ section, content, append }) => {
        try {
            await ensureAgentDir()
            const current = await fs.readFile(INDEX_PATH, "utf-8")
            const updated = touchTimestamp(safeSectionReplace(current, section, content, append ?? false))
            await fs.writeFile(INDEX_PATH, updated, "utf-8")
            return `[DONE] .agent/index.md -> section "${section.trim()}" ${append ? "appended" : "updated"}`
        } catch (err: any) {
            return `[ERROR] Could not update agent index: ${err.message}`
        }
    },
    {
        name: "update_agent_index",
        description: "Replace or append Markdown content in a section of .agent/index.md. Keep this file high-level and concise. Common sections are Project Overview, Tech Stack, Entry Points, Module Map, Key Conventions, and Known Issues.",
        schema: z.object({
            section: z.string().min(1).describe("Section heading without the ## prefix"),
            content: z.string().describe("Markdown content for the section"),
            append: z.boolean().optional().describe("Append to the existing section instead of replacing it")
        })
    }
)

export const readAgentModuleTool = tool(
    async ({ module_name }) => {
        try {
            await ensureAgentDir()
            const normalized = module_name.trim().replace(/\.md$/i, "")
            const content = await fs.readFile(modulePath(normalized), "utf-8")
            return `[INFO] .agent/modules/${normalized}.md\n\n${content}`
        } catch (err: any) {
            if (err.code === "ENOENT") return `[WARN] No module file for "${module_name}" yet. Use write_agent_module to create it.`
            return `[ERROR] Could not read module "${module_name}": ${err.message}`
        }
    },
    {
        name: "read_agent_module",
        description: "Read a module-specific memory file from .agent/modules/<name>.md. Use this for details about a specific area such as auth, API, UI, database, or deployment.",
        schema: z.object({ module_name: z.string().min(1).describe("Module name with or without the .md extension") })
    }
)

export const writeAgentModuleTool = tool(
    async ({ module_name, section, content, append }) => {
        try {
            await ensureAgentDir()
            const normalized = module_name.trim().replace(/\.md$/i, "")
            const filePath = modulePath(normalized)
            let current: string
            try {
                current = await fs.readFile(filePath, "utf-8")
            } catch (err: any) {
                if (err.code !== "ENOENT") throw err
                current = MODULE_TEMPLATE(normalized)
            }

            const updated = touchTimestamp(safeSectionReplace(current, section, content, append ?? false))
            await fs.writeFile(filePath, updated, "utf-8")
            return `[DONE] .agent/modules/${normalized}.md -> section "${section.trim()}" ${append ? "appended" : "updated"}`
        } catch (err: any) {
            return `[ERROR] Could not update module "${module_name}": ${err.message}`
        }
    },
    {
        name: "write_agent_module",
        description: "Create or update a module-specific memory file in .agent/modules/<name>.md. Use sections such as Overview, Key Files, Exports & API Surface, Patterns & Conventions, Dependencies, and Known Issues. Update the index Module Map separately when adding a module.",
        schema: z.object({
            module_name: z.string().min(1).describe("Module name with or without the .md extension"),
            section: z.string().min(1).describe("Section heading without the ## prefix"),
            content: z.string().describe("Markdown content for the section"),
            append: z.boolean().optional().describe("Append to the existing section instead of replacing it")
        })
    }
)

export const listAgentModulesTool = tool(
    async () => {
        try {
            await ensureAgentDir()
            const files = (await fs.readdir(MODULES_DIR)).filter((file) => file.endsWith(".md")).sort()
            if (!files.length) return "No module files yet in .agent/modules/."

            const previews = await Promise.all(files.map(async (file) => {
                const content = await fs.readFile(path.join(MODULES_DIR, file), "utf-8")
                const overview = content.match(/^## Overview\s*\n([\s\S]*?)(?=^## |$)/m)?.[1]?.trim() || "No overview"
                return `[MODULE] ${file.replace(/\.md$/, "")} - ${overview.replace(/\s+/g, " ").slice(0, 160)}`
            }))
            return `Available modules (${files.length}):\n${previews.join("\n")}`
        } catch (err: any) {
            return `[ERROR] Could not list agent modules: ${err.message}`
        }
    },
    {
        name: "list_agent_modules",
        description: "List all module memory files in .agent/modules/ with a short Overview preview.",
        schema: z.object({})
    }
)

type EmbeddingRecord = { embeddedAt: string; chunkCount: number }

export const readEmbeddingsIndexTool = tool(
    async () => {
        try {
            const raw = await fs.readFile(EMBEDDINGS_PATH, "utf-8")
            const data = JSON.parse(raw) as Record<string, EmbeddingRecord>
            const entries = Object.entries(data)
            if (!entries.length) return "No files have been embedded yet."

            const lines = entries.map(([file, info]) => {
                const date = info?.embeddedAt ? new Date(info.embeddedAt).toLocaleDateString() : "unknown date"
                return `  ${file} - embedded ${date}, ${info?.chunkCount ?? 0} chunks`
            })
            return `[INFO] Embedded files (${entries.length}):\n${lines.join("\n")}`
        } catch (err: any) {
            if (err.code === "ENOENT") return "No embeddings index yet. Record embeddings after indexing the codebase."
            return `[ERROR] Could not read embeddings index: ${err.message}`
        }
    },
    {
        name: "read_embeddings_index",
        description: "Read the local .agent/embeddings.json index to see which files have been embedded, when they were indexed, and how many chunks each file contains.",
        schema: z.object({})
    }
)

export async function recordEmbeddings(fileChunkMap: Record<string, number>): Promise<void> {
    await ensureAgentDir()
    let existing: Record<string, EmbeddingRecord> = {}
    try {
        existing = JSON.parse(await fs.readFile(EMBEDDINGS_PATH, "utf-8"))
    } catch (err: any) {
        if (err.code !== "ENOENT") throw err
    }

    const embeddedAt = new Date().toISOString()
    for (const [file, chunkCount] of Object.entries(fileChunkMap)) {
        existing[file] = { embeddedAt, chunkCount }
    }
    await fs.writeFile(EMBEDDINGS_PATH, JSON.stringify(existing, null, 2), "utf-8")
}

// Keep the original misspelled export as a compatibility alias.
export const recoredEmbeddings = recordEmbeddings

export const agentMemoryTools = [
    readAgentIndexTool,
    updateAgentIndexTool,
    readAgentModuleTool,
    writeAgentModuleTool,
    listAgentModulesTool,
    readEmbeddingsIndexTool
]

export const selectAgentMemoryTools = {
    read_agent_index: readAgentIndexTool,
    update_agent_index: updateAgentIndexTool,
    read_agent_module: readAgentModuleTool,
    write_agent_module: writeAgentModuleTool,
    list_agent_modules: listAgentModulesTool,
    read_embeddings_index: readEmbeddingsIndexTool
} as Record<string, any>
