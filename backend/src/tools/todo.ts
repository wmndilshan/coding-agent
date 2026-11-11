import fs from "fs"
import path from "path"
import { tool } from "@langchain/core/tools"
import { z } from "zod"
import { v4 as uuidv4, validate as isUUID } from "uuid"
import { WORKING_DIR } from "./fileSystem"

const BASE_DIR = path.join(WORKING_DIR, ".agent-todos")
const STATUS = z.enum(["pending", "in_progress", "completed", "blocked"])
const InputTaskSchema = z.object({
    task: z.string().min(1),
    assigned_to: z.string().min(1),
    status: STATUS.default("pending"),
    parent_id: z.string().optional(),
    dependencies: z.array(z.string()).default([])
})

function todoPath(filename: string): string {
    const normalized = filename.trim().replace(/\\/g, "/").replace(/^\/+/, "")
    const withExtension = normalized.endsWith(".todos.json") ? normalized : `${normalized}.todos.json`
    const resolved = path.resolve(BASE_DIR, withExtension)
    const relative = path.relative(BASE_DIR, resolved)
    if (!normalized || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("[BLOCKED] TODO filename must stay inside .agent-todos")
    }
    return resolved
}

async function readTodoFile(filename: string): Promise<{ path: string; todos: any[] }> {
    const filePath = todoPath(filename)
    const todos = JSON.parse(await fs.promises.readFile(filePath, "utf8"))
    if (!Array.isArray(todos)) throw new Error("TODO file must contain an array")
    return { path: filePath, todos }
}

export const write_todos = tool(async ({ filename, todos }, config: any) => {
    try {
        const filePath = todoPath(filename)
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        const now = new Date().toISOString()
        const enriched = todos.map((task) => ({
            id: uuidv4(), ...task, dependencies: task.dependencies ?? [], created_at: now, updated_at: now
        }))
        await fs.promises.writeFile(filePath, JSON.stringify(enriched, null, 2), "utf8")
        config?.writer?.({ todos: enriched })
        return `[SUCCESS] TODO list saved: ${path.relative(BASE_DIR, filePath)}\n${JSON.stringify(enriched, null, 2)}`
    } catch (error: any) { return `[ERROR] Error writing TODO list: ${error.message}` }
}, {
    name: "write_todos",
    description: "Create or overwrite a workflow TODO list. IDs and timestamps are generated automatically.",
    schema: z.object({
        filename: z.string().min(1).describe("TODO filename or relative path, with or without .todos.json"),
        todos: z.array(InputTaskSchema)
    })
})

export const read_todos = tool(async ({ filename }) => {
    try {
        const { todos } = await readTodoFile(filename)
        return `[TODO] ${JSON.stringify(todos, null, 2)}`
    } catch (error: any) {
        return error.code === "ENOENT" ? "No TODO list found." : `[ERROR] Error reading TODO list: ${error.message}`
    }
}, {
    name: "read_todos",
    description: "Read a workflow TODO list by filename.",
    schema: z.object({ filename: z.string().min(1) })
})

export const update_todos = tool(async ({ filename, updates }, config: any) => {
    try {
        if (updates.some((update) => !isUUID(update.id))) return "[WARN] Every update must use a valid task UUID."
        const { path: filePath, todos } = await readTodoFile(filename)
        const now = new Date().toISOString()
        let updatedCount = 0
        for (const update of updates) {
            const index = todos.findIndex((task) => task.id === update.id)
            if (index === -1) continue
            const { id, ...changes } = update
            todos[index] = { ...todos[index], ...changes, updated_at: now }
            updatedCount++
        }
        await fs.promises.writeFile(filePath, JSON.stringify(todos, null, 2), "utf8")
        config?.writer?.({ update_todos: updates })
        return `[DONE] Updated ${updatedCount} of ${updates.length} TODO task(s).`
    } catch (error: any) {
        return error.code === "ENOENT" ? "No TODO list found." : `[ERROR] Error updating TODO list: ${error.message}`
    }
}, {
    name: "update_todos",
    description: "Update TODO tasks by UUID. Only supplied task fields are changed; updated_at is refreshed automatically.",
    schema: z.object({
        filename: z.string().min(1),
        updates: z.array(z.object({
            id: z.string(), task: z.string().optional(), assigned_to: z.string().optional(), status: STATUS.optional()
        })).min(1)
    })
})

export const get_next_runnable_task = tool(async ({ filename }) => {
    try {
        const { todos } = await readTodoFile(filename)
        const runnable = todos.filter((task) => task.status === "pending" && (task.dependencies ?? []).every((dependency: string) => {
            const prerequisite = todos.find((candidate) => candidate.id === dependency)
            return !prerequisite || prerequisite.status === "completed"
        }))
        return runnable.length ? `[NEXT] ${JSON.stringify(runnable[0], null, 2)}` : "[NEXT] No runnable TODO tasks."
    } catch (error: any) {
        return error.code === "ENOENT" ? "No TODO list found." : `[ERROR] Error finding runnable task: ${error.message}`
    }
}, {
    name: "get_next_runnable_task",
    description: "Return the first pending TODO task whose dependencies are completed.",
    schema: z.object({ filename: z.string().min(1) })
})

export const todoListTools = [read_todos, update_todos, write_todos, get_next_runnable_task]
export const selectTodoTools = {
    read_todos, update_todos, write_todos,
    get_next_runnable_task,
    get_next_runnable_tasks: get_next_runnable_task
} as Record<string, any>
