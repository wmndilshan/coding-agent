import { appendAFile, createAFile, emptyAFile, readAFile, resolveSafePath } from "../helper/fsHelper"
import { promises as fs } from "node:fs"
import path from "node:path"

function todayDateString(now = new Date()) {
    return now.toISOString().slice(0, 10)
}

function nowTimeString(now = new Date()) {
    return now.toISOString().slice(11, 19)
}

async function fileExists(filePath: string) {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

export interface UserData {
    userId: string,
    projectId: string
}

export class MemoryStore {
    private memoryRoot
    private userData: UserData

    constructor(memoryRoot: string, userData: UserData) {
        this.memoryRoot = memoryRoot
        this.userData = userData
    }
    
    async emptyAFileContent() {
        await emptyAFile(this.memoryRoot, this.todayLogPath())
    }

    todayLogPath(now = new Date()) {
        return `${todayDateString(now)}-${this.userData.userId}-${this.userData.projectId}.md`
    }

    async init() {
        await this.ensureCoreFiles()
    }

    async ensureCoreFiles() {
        const defaults = [
            {
                path: `MEMORY-${this.userData.userId}.md`,
                content: "# LONGTERM MEMORY\n\n"
            },
            {
                path: `DAILY_LOG_ARCHIVE-${this.userData.userId}.md`,
                content: "# DAILY_LOG_ARCHIVE\n\n"
            },
            {
                path: `system_prompt-${this.userData.userId}.md`,
                content: `# SYSTEM PROMPT\n\n
                Follow the policy and be helpful`
            }
        ]
        await this.ensureTodayLog()

        for (const file of defaults) {
            const fullPath = resolveSafePath(this.memoryRoot, file.path)
            if (!(await fileExists(fullPath))) {
                await createAFile(this.memoryRoot, file.path, file.content)
            }
        }
    }

    async ensureTodayLog(now = new Date()) {
        const relativePath = this.todayLogPath()
        const fullPath = resolveSafePath(this.memoryRoot, relativePath)
        if (!(await fileExists(fullPath))) {
            await createAFile(this.memoryRoot, relativePath, `# Daily Log ${todayDateString(now)}\n\n`)
        }
        return relativePath
    }

    async logInteraction(role: string, content: string, now = new Date()) {
        const logPath = await this.ensureTodayLog(now)
        const chunk = `## [Time: ${nowTimeString(now)}] Role: ${role}\n${content}\n\n`
        await appendAFile(this.memoryRoot, logPath, chunk)
        return logPath
    }

    async logToArchive(role: string, content: string, now = new Date()) {
        const logPath = `DAILY_LOG_ARCHIVE-${this.userData.userId}.md`
        const chunk = `## [Time: ${nowTimeString(now)}] Role: ${role}\n${content}\n\n`
        await appendAFile(this.memoryRoot, logPath, chunk)
        return logPath
    }

    async readArchiveFile() {
        try {
            const data = await readAFile(this.memoryRoot, `DAILY_LOG_ARCHIVE-${this.userData.userId}.md`)
            return {
                data,
                exist: true
            }
        } catch (error) {
            return {
                exist: false
            }
        }
    }

    async readToday(now = new Date()) {
        const logPath = await this.ensureTodayLog(now)
        return readAFile(this.memoryRoot, logPath)
    }

    async readMemoryFiles(name: string) {
        const relativePath = name.replace(/^[/\\]+/, "")
        const fullPath = resolveSafePath(this.memoryRoot, relativePath)
        if (!(await fileExists(fullPath))) {
            await createAFile(this.memoryRoot, relativePath, "")
        }
        return readAFile(this.memoryRoot, relativePath)
    }
}
