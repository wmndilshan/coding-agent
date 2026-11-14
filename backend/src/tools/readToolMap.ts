import fs from "fs"
import path from "path"
import { tool } from "@langchain/core/tools"
import { z } from "zod"

const ROOT = process.cwd()
const BASE_DIR = path.join(ROOT, "public", "tool")

export const readToolMap = tool(
    async ({ filename, offset = 0, limit = 0 }) => {
        try {
            const resolvedPath = path.resolve(BASE_DIR, filename)

            const relative = path.relative(BASE_DIR, resolvedPath)
            if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw new Error("Access outside allowed directory is not permitted.")
            }

            const content = await fs.promises.readFile(resolvedPath, "utf8")
            const lines = content.split("\n")

            const end = limit > 0 ? offset + limit : lines.length
            const slice = lines.slice(offset, end)

            const formatted = slice
                .map((line, i) => `${(offset + i + 1).toString().padStart(4)} | ${line}`)
                .join("\n")

            if (end < lines.length) {
                const remaining = lines.length - end
                return `${formatted}\n\n[... ${remaining} more lines. Use offset=${offset + limit} to continue reading ... ]`
            }
            return `${formatted}`
        } catch (error: any) {
            return `Error reading file: ${error.message}`
        }
    },
    {
        name: "read_tool_map",
        description: `
        Read a tool-map file inside public/tool and return it with line numbers and pagination.
        
        - Use offset and limit to read in chunks.
        - Returns continuation hint if more lines remain.
        - Each line is prefixed with its number.
        `,
        schema: z.object({
            filename: z.string().describe("Filename to read relative to project root"),
            offset: z.number().optional().default(0),
            limit: z.number().int().min(0).optional().default(200)
        })
    }
)
