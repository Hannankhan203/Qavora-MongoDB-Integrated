import express from "express";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();
const PORT = 5000;

// Shared database reference
let db;

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Qavora backend is running successfully."
  });
});

// GET /api/tests endpoint - Fetch all documents from the 'tests' collection
app.get("/api/tests", async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({
        error: "Database is not connected."
      });
    }

    const tests = await db.collection("tests").find({}).toArray();
    res.json(tests);
  } catch (error) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error querying tests collection: ${safeError}`);
    res.status(500).json({
      error: "Failed to fetch tests."
    });
  }
});

async function startServer() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB;

  if (!uri) {
    console.error("Configuration error: MONGODB_URI environment variable is missing.");
    process.exit(1);
  }

  if (!dbName) {
    console.error("Configuration error: MONGODB_DB environment variable is missing.");
    process.exit(1);
  }

  let client;

  try {
    client = new MongoClient(uri);
    await client.connect();

    // Verify connectivity by running a ping command against the database
    db = client.db(dbName);
    await db.command({ ping: 1 });
    console.log(`Successfully connected to MongoDB Atlas (database: ${dbName}).`);
  } catch (error) {
    const safeErrorMessage = (error?.message || "Unknown error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Failed to connect to MongoDB Atlas: ${safeErrorMessage}`);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Qavora backend server running on http://localhost:${PORT}`);
  });
}

startServer();
