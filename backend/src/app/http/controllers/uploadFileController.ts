import { NextFunction, Router } from "express"
import multer from "multer"
import AdmZip from "adm-zip"
import fs from "fs/promises"
import path from "path"

const upload = multer({ storage: multer.memoryStorage() , limits: { fileSize: 100 * 1024 * 1024 }})
const BLOCK_DIRS = new Set(["node_modules", ".git", "build", "dist", ".env"])


function isSafePath(p: string) {
    return !p.split(/[\\/]/).some((seg) => BLOCK_DIRS.has(seg) || seg === "..")
}

export function uploadProject(router: Router) {
    return router.post("/upload-zip", upload.single("project"), uploadProject)
}

const uploadZipFile = async (req: any, res: any, next: NextFunction) => {
    if (!req.file) return res.stauts(400).json({ error: "No file." })

    const { userId, projectId, clean } = req.body as Record<string, any>

    if (!userId || !projectId) {
        return res.status(400).json({ error: "userId and projectId are required." })
    }

    const TARGET_DIR = path.join(
        process.cwd(),
        "Public", 
        "working-dir",
        `project-${userId}`
    )

    try {
        await fs.mkdir(TARGET_DIR, { recursive: true })
        if (clean === "true") {
            const entries = await fs.readdir(TARGET_DIR, { withFileTypes: true })
            for (const e of entries) {
                if (e.name === "README.md" || e.name ===".agent") continue
                await fs.rm(path.join(TARGET_DIR, e.name), { recursive: true, force: true })
            }
        }

        const zip = new AdmZip(req.file.buffer)
        const written = []
        const skipped = []

        for (const entry of zip.getEntries()) {
            if (!isSafePath(entry.entryName) || entry.isDirectory) {
                if (!isSafePath(entry.entryName)) skipped.push(entry.entryName)
                continue
            }
            const dest = path.join(TARGET_DIR, entry.entryName)
            await fs.mkdir(path.dirname(dest), { recursive: true })
            await fs.writeFile(dest, entry.getData())
            written.push(entry.entryName)
        }

        res.json({
            message: `Extracted to ${userId}'s working directory.`,
            files: written,
            target: `working-dir/project-${userId}/${projectId}`
        })
    } catch (error) { next(error) }
}