import { tool } from "@langchain/core/tools"
import { z } from "zod"
import fs from "fs/promises"
import path from "path"
import { glob } from "glob"

export const WORKING_DIR = path.resolve(process.cwd(), "public/working-dir")

const IGNORE_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "next", "nuxt", "coverage", "cache", "__pycache__", ".turbo", "out"
])

export function safePath(filePath: string) {
    const resolved = path.resolve(WORKING_DIR, filePath)
    const relative = path.relative(WORKING_DIR, resolved)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`[BLOCKED] Path traversal blocked: ${filePath}`)
    }
    return resolved
}

export const readFileTool = tool(
    async ({ file_path, start_line, end_line }) => {
        try {
            const fullPath = safePath(file_path)
            const raw = await fs.readFile(fullPath, "utf-8")
            const lines = raw.split("\n")

            const from = start_line ? start_line - 1 : 0
            const to = end_line ?? lines.length
            const slice = lines.slice(from, to)

            const numbered = slice.map((l, i) => `${from + i + 1} | ${l}`).join("\n")
            const rangeInfo = (start_line || end_line) ? `  (lines ${from + 1}-${to})` : ""

            return `[INFO] ${file_path}${rangeInfo}\n\`\`\`\n${numbered}\n\`\`\``
        } catch (err: any) {
            return `Error reading file: ${err.message}`
        }
    },
    {
        name: "read_file",
        description: "Read the contents of a file with line numbers. Optionally read a specific line range.",
        schema: z.object({
            file_path: z.string().describe("Path to the file relative to the working directory"),
            start_line: z.number().optional().describe("First line to read (1-indexed). Omit to read from the beginning."),
            end_line: z.number().optional().describe("Last line to read (inclusive). Omit to read to the end of the file.")
        })
    }
)


export const writeFileTool = tool(
    async ({ file_path, content }) => {
        try {
            const fullPath = safePath(file_path)
            await fs.mkdir(path.dirname(fullPath), { recursive: true })
            await fs.writeFile(fullPath, content, "utf-8")
            const lineCount = content.split("\n").length
            return `Written: ${file_path} (${lineCount} lines)`
        } catch (err: any) {
            return `[ERROR] Writing file: ${err.message}`
        }
    },
    {
        name: "write_file",
        description: "Create a new file or fully overwrite an existing one. For targeted edits to existing files, read the file first to preserve existing content or use an edit tool.",
        schema: z.object({
            file_path: z.string().describe("Path to the file relative to the working directory"),
            content: z.string().describe("The full content to write to the file")
        })
    }
)


export const editFileTool = tool(
    async ({ file_path, old_str, new_str }) => {
        try {
            const fullPath = safePath(file_path)
            const content = await fs.readFile(fullPath, "utf-8")

            const occurrences = content.split(old_str).length - 1
            if (occurrences === 0) {
                return `[ERROR] old_str not found in ${file_path}. Check that it matches the file exactly.`
            }
            if (occurrences > 1) {
                return `[ERROR] old_str found ${occurrences} times in ${file_path}. It must be unique.`
            }

            const updated = content.replace(old_str, new_str)
            await fs.writeFile(fullPath, updated, "utf-8")

            const removed = old_str.split("\n").length
            const added = new_str.split("\n").length

            return `[INFO] Edited: ${file_path} (-${removed} lines / +${added} lines)`
        } catch (err: any) {
            return `[ERROR] Editing file: ${err.message}`
        }
    },
    {
        name: "edit_file",
        description: `Surgically edit a file by replacing a unique string (old_str) with new content (new_str)  
            old_str must appear exactly once - including enough surrounding context to make it unique within the file
            Always read_file before edting so you have the exact content.`,
        schema: z.object({
            file_path: z.string().describe("Path to the file relative to the working directory"),
            old_str: z.string().describe("The exact unique text to replace"),
            new_str: z.string().describe("The replacement text")
        })
    }
)

async function buildTree(dirPath: string, prefix = "") {
    let output = ""
    let entries: import("fs").Dirent[]

    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
        return output
    }

    const visible = entries.filter(
        (e) => !IGNORE_DIRS.has(e.name) && !e.name.startsWith(".")
    ).sort((a, b) => a.name.localeCompare(b.name))

    for (const [index, entry] of visible.entries()) {
        const isLast = index === visible.length - 1
        const branch = isLast ? "└── " : "├── "
        output += `${prefix}${branch}${entry.name}${entry.isDirectory() ? "/" : ""}\n`

        if (entry.isDirectory()) {
            output += await buildTree(
                path.join(dirPath, entry.name),
                `${prefix}${isLast ? "    " : "│   "}`
            )
        }
    }

    return output
}

export const fileTreeTool = tool(
    async ({ directory }) => {
        try {
            const targetDir = directory ? safePath(directory) : WORKING_DIR
            const label = directory || "."
            const tree = await buildTree(targetDir)

            return `${label}/\n${tree || "(empty)"}`
        } catch (err: any) {
            return `Error building file tree: ${err.message}`
        }
    },
    {
        name: "file_tree",
        description: "Get a full recursive file tree of the project, excluding generated and dependency directories.",
        schema: z.object({
            directory: z.string().optional().describe("Subdirectory to tree, relative to the working directory")
        })
    }
)

export const listDirTool = tool(
    async ({ directory }) => {
        try {
            const fullPath = directory ? safePath(directory) : WORKING_DIR
            const entries = await fs.readdir(fullPath, { withFileTypes: true })

            const lines = entries.map((e) => {
                const type = e.isDirectory() ? "[dir ]" : "[file]"
                return `${type} ${e.name}`
            })

            return `Contents of ${directory || "."}:\n${lines.length ? lines.join("\n") : "(empty)"}`
        } catch (err: any) {
            return `Error listing directory: ${err.message}`
        }
    },
    {
        name: "list_dir",
        description: "List the immediate files and directories in a directory.",
        schema: z.object({
            directory: z.string().optional().describe("Directory relative to the working directory")
        })
    }
)

export const lsTool = tool(
    async ({ directory, pattern }) => {
        try {
            const base = directory ? safePath(directory) : WORKING_DIR
            const globPattern = pattern ?? "**/*"
            const files = await glob(globPattern, {
                cwd: base,
                ignore: [...Array.from(IGNORE_DIRS).map((dir) => `**/${dir}/**`)],
                nodir: true
            })

            if (files.length === 0) return `No files matched pattern "${globPattern}"`
            return `${files.length} files in ${directory || "."}:\n${files.join("\n")}`
        } catch (err: any) {
            return `Error listing files: ${err.message}`
        }
    },
    {
        name: "ls",
        description: "List all files matching a glob pattern. Good for finding files by extension or path",
        schema: z.object({
            directory: z.string().optional().describe("Base directory relative to working dir"),
            pattern: z.string().optional().describe("Glob pattern, e.g. '**/*.ts' or 'src/**/*.js'")
        })
    }
)

export const searchFileTool = tool(
    async ({ query, file_patterns, case_sensitive }) => {
        try {
            const pattern = file_patterns || "**/*.{js,ts,jsx,tsx}"
            const files = await glob(pattern, {
                cwd: WORKING_DIR,
                ignore: [...Array.from(IGNORE_DIRS).map((dir) => `**/${dir}/**`)],
                nodir: true
            })

            const flags = case_sensitive ? "" : "i"
            const regex = new RegExp(query, `g${flags}`)
            const results: string[] = []

            for (const file of files) {
                const fullPath = path.join(WORKING_DIR, file)
                const content = await fs.readFile(fullPath, "utf-8")
                const lines = content.split("\n")
                const matches: any[] = []

                lines.forEach((line, i) => {
                    regex.lastIndex = 0
                    if (regex.test(line)) {
                        matches.push(`  ${i + 1}: ${line.trim()}`)
                    }
                })

                if (matches.length > 0) {
                    results.push(`[FILE] ${file} (${matches.length} match${matches.length > 1 ? "es" : ""})\n${matches.join("\n")}`)
                }
            }

            if (results.length === 0) return `No matches found for "${query}"`
            return `[SEARCH] "${query}" - ${results.length} file${results.length > 1 ? "s" : ""}:\n\n${results.join("\n\n")}`
        } catch (err: any) {
            return `Error searching files: ${err.message}`
        }
    },
    {
        name: "search_file",
        description: "Search for a string or regex pattern across files (like grep). Returns matching line",
        schema: z.object({
            query: z.string().describe("String or regex pattern to search for"),
            file_patterns: z.string().optional().describe("Glob pattern for files to search (default '**)/*.{js,ts,jsx,tsx}')"),
            case_sensitive: z.boolean().optional().describe("Match case sensitive (default false)")
        })
    }
)

export const fileSystemTools = [
    readFileTool,
    writeFileTool,
    editFileTool,
    fileTreeTool,
    listDirTool,
    lsTool,
    searchFileTool
]

export const selectFileSystemTool = {
    read_file: readFileTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    file_tree: fileTreeTool,
    list_dir: listDirTool,
    ls: lsTool,
    search_file: searchFileTool
} as Record<string, any>