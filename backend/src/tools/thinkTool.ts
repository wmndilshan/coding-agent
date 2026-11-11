import { tool } from "langchain"
import { z } from "zod"

export const think_tool = tool(
    async ({ reflection }) => {
        return `<think>${reflection}</think>`
    },
    {
        name: "think_tool",
        description: `A scratchpad to reason before action on code. Free and instant - no external cells.
        
        Use it:
        - Before editing a file         -> did impact_analysis show risk? am I editing the right place?
        - After ast_analyze             -> which functions actually need to change?
        - Before write_file             -> does this file already exist, and does the change follow project conventions?
        - After a bash error            -> what exactly failed: a missing dependency, syntax error, or wrong command?
        - Before a refactor             -> have I read all affected files? do I understand the full blast radius?
        - After build_import_graph      -> which entry points and central files should I avoid touching?
        - Before updating agent memory -> what did I actually learn that is worth persisting?
        
        Reflection structure:
        1. What I Know so far (files read, graph built, errors seen)
        2. Risk or uncertainty (what could break, what I haven't checked)
        3 Decision - proceed with edit / read more first / ask user`,
        schema: z.object({
            reflection: z.string().describe("Your reasoning - current state, risks, and next action.")
        })
    }
)
