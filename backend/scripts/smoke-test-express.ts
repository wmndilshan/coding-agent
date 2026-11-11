/**
 * Smoke-test Express routes that do not require GitHub OAuth / Mongo session.
 * DB connect is skipped; session middleware may warn without Mongo.
 * Run: npx ts-node -r dotenv/config scripts/smoke-test-express.ts
 */
import express, { Express, NextFunction, Response, Request } from "express"
import cors from "cors"
import http from "http"

function handleExpressError(err: Error, req: Request, res: Response, next: NextFunction) {
    const statusCode = res.statusCode !== 200 ? res.statusCode : 500
    res.statusCode = statusCode
    res.json({
        error: {
            message: err.message,
            status: statusCode
        }
    })
}

async function request(port: number, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
            const chunks: Buffer[] = []
            res.on("data", (c) => chunks.push(c))
            res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf-8") }))
        })
        req.on("error", reject)
    })
}

async function main() {
    const app: Express = express()
    app.use(cors({ origin: "*", credentials: true }))
    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    app.get("/", async (_req, res) => {
        res.json({ message: "server is up" })
    })

    app.get("/auth/login", (_req, res) => {
        res.status(401).json({ error: "Authentication failed" })
    })

    app.get("/auth/gitub", (_req, res) => {
        res.redirect("/auth/github")
    })

    app.get("/auth/me", (req: any, res: any) => {
        if (!req.user) return res.status(401).json({ error: " Not logged in" })
        res.json({ user: req.user })
    })

    app.get("/__boom", (_req, _res, next) => {
        next(new Error("boom"))
    })
    app.use(handleExpressError)

    const server = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s))
    })
    const addr = server.address()
    if (!addr || typeof addr === "string") throw new Error("no port")
    const port = addr.port

    const checks: Array<{ name: string; ok: boolean; detail: string }> = []

    const health = await request(port, "/")
    checks.push({
        name: "GET / health",
        ok: health.status === 200 && health.body.includes("server is up"),
        detail: `${health.status} ${health.body}`
    })

    const login = await request(port, "/auth/login")
    checks.push({
        name: "GET /auth/login",
        ok: login.status === 401 && login.body.includes("Authentication failed"),
        detail: `${login.status} ${login.body}`
    })

    const me = await request(port, "/auth/me")
    checks.push({
        name: "GET /auth/me unauthenticated",
        ok: me.status === 401 && me.body.includes("Not logged in"),
        detail: `${me.status} ${me.body}`
    })

    const typo = await request(port, "/auth/gitub")
    checks.push({
        name: "GET /auth/gitub redirects",
        ok: typo.status === 302 || typo.status === 301,
        detail: `${typo.status} ${typo.body}`
    })

    const boom = await request(port, "/__boom")
    checks.push({
        name: "error handler",
        ok: boom.status === 500 && boom.body.includes("boom"),
        detail: `${boom.status} ${boom.body}`
    })

    for (const c of checks) {
        console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`)
        if (!c.ok) console.log(`      ${c.detail}`)
    }

    const failed = checks.filter((c) => !c.ok).length
    console.log(`\nPassed: ${checks.length - failed} / ${checks.length}`)
    server.close()
    if (failed) process.exitCode = 1
}

main().catch((err) => {
    console.error(err)
    process.exitCode = 1
})
