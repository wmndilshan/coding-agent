import express from "express"
import "dotenv/config"
import { bootstrapApp } from "./app/bootstrap"

const app = express()


const PORT = parseInt(process.env.PORT as string)

bootstrapApp(app, PORT)