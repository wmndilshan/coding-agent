import express, { Router } from "express"
import cors from "cors"
import { Express, NextFunction, Response, Request } from "express"
import { handleExpressError } from "../exceptions/handleExpressError"
import passport from "passport"
import session from "express-session"
import { Strategy as GithubStrategy } from "passport-github2"
import MongoStore from "connect-mongo"

import mongoose from "mongoose"
import { UserService } from "@/app/services/UserService"

export function expressServer(app: Express, PORT: number) {
    const router = Router()

    app.use(cors({
        origin: "*",
        credentials: true
    }))

    app.use(express.json())
    app.use(express.urlencoded({ extended: true }))

    app.use(handleExpressError)

    app.get("/", async (req: Request, res: Response) => {
        res.json({ message: "server is up" })
    })

    const clientPromise = mongoose.connection.asPromise().then((conn) => conn.getClient())
    clientPromise.catch(() => { })

    const store = MongoStore.create({
        clientPromise,
        collectionName: "sessions"
    })
    store.collectionP.catch(() => { })

    const sess = {
        store,
        secret: process.env.COOKIE_KEY as string,
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }
    }

    if (process.env.NODE_ENV === "production") {
        app.set("trust proxy", 1)
        sess.cookie.secure = true
    }

    app.use(session(sess))
    app.use(passport.initialize())
    app.use(passport.session())

    passport.use(
        new GithubStrategy(
            {
                clientID: process.env.GITHUB_CLIENT_ID as string,
                clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
                callbackURL: process.env.CALL_BACK_URL as string
            },
            async (accessToken: string, refreshToken: string, profile: any, done: any) => {
                try {
                    const id = profile?.id
                    const name = profile?.name
                    const image = profile?.photos?.[0]?.value

                    const userService = UserService.getInstance()
                    await userService.createUser({
                        id,
                        name,
                        image,
                        access_token: accessToken,
                        refresh_token: refreshToken
                    })
                    return done(null, { id, name, image })
                } catch (error) {
                    return done(error)
                }
            }
        )
    )

    passport.serializeUser((user: any, done) => {
        done(null, user)
    })

    passport.deserializeUser(async (obj: any, done) => {
        try {
            done(null, obj)
        } catch (err) {
            done(err)
        }
    })

    app.get("/auth/login", (req: Request, res: Response) => {
        res.status(401).json({ error: "Authentication failed" })
    })

    app.get("/auth/gitub", (req: Request, res: Response) => {
        res.redirect("/auth/github")
    })

    app.get(
        "/auth/github",
        passport.authenticate("github", { scope: ["user:email"] })
    )

    app.get(
        "/auth/github/callback",
        passport.authenticate("github", {
            failureRedirect: "/auth/login",
            successRedirect: process.env.FRONT_APP_URL
        })
    )

    app.get(
        "/auth/logout",
        (req: Request, res: Response, next: NextFunction) => {
            req.logout((err) => {
                if (err) return next(err)
                req.session.destroy(() => {
                    res.clearCookie("connect:sid")
                    res.json({ message: "Logout successfully" })
                })
            })
        }
    )

    app.get(
        "/auth/me",
        (req: any, res: any) => {
            if (!req.user) return res.status(401).json({ error: " Not logged in" })
            res.json({ user: req.user })
        }
    )

    app.listen(PORT, () => {
        console.log(`Express server is running at http://localhost:${PORT}`)
    })
}
