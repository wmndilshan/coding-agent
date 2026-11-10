import mongoose from "mongoose"

export async function dbConnection() {
    try {
        await mongoose.connect(process.env.DB_URL as string)
        console.log("Connected to MongoDB successfully!")
    } catch (err: any) {
        console.error("Db connection Error:", err?.message || err)
    }
}