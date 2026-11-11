export const TOOL_REGISTRY = {
    filesystem: {
        description: "Full file operations - write, edit, search, ls, file tree",
        load: (toolName: string) => import("./fileSystem").then(m => m.selectFileSystemTool[toolName])
    },
    bash: {
        description: "Shell execution - run commands, npm, node, netstat (Windows)",
        tools: ["bash"],
        load: (toolName: string) => import("./bash").then(m => m.selectBashTool[toolName])
    },
    graph: {
        description: "Import dependency map - build graph, query deps, impact analysis",
        load: (toolName: string) => import("./importGraph").then(m => m.selectGraphTool[toolName])
    },
    memory: {
        description: "Agent memory - read/write, .agent/module files and embeddings index",
        tools: ["read_agent_index", "update_agent_index", "read_agent_module", "write_agent_module", "list_agent_modules", "read_embeddings_index"],
        load: (toolName: string) => import("./projectContextBuilder").then(m => m.selectAgentMemoryTools[toolName])
    },
    rag: {
        description: "Semantic search - embed codebase files and query by concept",
        tools: ["embed_codebase", "query_codebase"],
        load: (toolName: string) => import("./rag").then(m => m.selectRagTools[toolName])
    },
    ast: {
        description: "Code structure analysis - extract imports, functions, classes, and types.",
        tools: ["ast_analyze"],
        load: (toolName: string) => import("./ast").then(m => [m.selectAstTools[toolName]])
    },
    git: {
        description: "Git awareness - diff, log, status. Read-only",
        tools: ["git_diff", "git_log", "git_status"],
        load: (toolName: string) => import("./git").then(m => m.selectGitTools[toolName])
    },
    todo: {
        description: "Create, read, update, and advance workflow TODO lists.",
        tools: ["read_todos", "update_todos", "write_todos", "get_next_runnable_tasks"],
        load: (toolName: string) => import("./todo").then(m => m.selectTodoTools[toolName])
    },
    task: {
        description: "Spawn subagents for parallel or isolated tasks",
        tools: ["task"],
        skill: null,
        load: () => import("./task/task").then(async (m) => {
            const { LLM } = await import("../llm/LLM")
            return [m.createTaskTool(LLM.getInstance("deepseek-chat"), { tools: [] })]
        })
    }
} as Record<string, any>
