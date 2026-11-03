import express from "express";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

let db = null;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

const mockTests = [
  { _id: "qav-test-001", name: "User Registration & Form Validation", status: "Passed" },
  { _id: "qav-test-002", name: "Authentication Session Expiry Check", status: "Active" },
  { _id: "qav-test-003", name: "Manual Test Suite Export & Import", status: "Passed" },
  { _id: "qav-test-004", name: "Cross-Device Checklist Synchronization", status: "Active" },
  { _id: "qav-test-005", name: "Defect Logging & Severity Assignment", status: "Passed" }
];

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Qavora backend is running successfully.",
    database: db ? "connected" : "mock-active"
  });
});

app.get("/api/tests", async (req, res) => {
  try {
    if (db) {
      const tests = await db.collection("tests").find({}).toArray();
      return res.json(tests);
    }
    return res.json(mockTests);
  } catch (error) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.warn(`[AI Studio] Error querying tests collection: ${safeError}. Returning mock data.`);
    return res.json(mockTests);
  }
});

// POST /api/tests endpoint - Save a new test document to the 'tests' collection
app.post("/api/tests", async (req, res) => {
  try {
    const { name, status } = req.body || {};

    if (
      typeof name !== "string" ||
      typeof status !== "string" ||
      name.trim() === "" ||
      status.trim() === ""
    ) {
      return res.status(400).json({
        error: "Both 'name' and 'status' are required and must be non-empty strings."
      });
    }

    if (!db) {
      return res.status(503).json({
        error: "Database is not connected."
      });
    }

    const trimmedName = name.trim();
    const trimmedStatus = status.trim();

    const newTest = {
      name: trimmedName,
      status: trimmedStatus
    };

    const result = await db.collection("tests").insertOne(newTest);

    return res.status(201).json({
      _id: result.insertedId,
      name: trimmedName,
      status: trimmedStatus
    });
  } catch (error) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.error(`Error saving test to database: ${safeError}`);
    return res.status(500).json({
      error: "Failed to save test."
    });
  }
});

async function startServer() {
  if (uri && dbName) {
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
      await client.connect();
      db = client.db(dbName);
      console.log(`Successfully connected to MongoDB Atlas (database: ${dbName}).`);
    } catch (error) {
      const safeErrorMessage = (error?.message || "Unknown error").replace(
        /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
        "mongodb+srv://[credentials-hidden]@"
      );
      console.warn(`MongoDB Atlas connection offline: ${safeErrorMessage}. Using in-memory fallback.`);
    }
  } else {
    console.log("MongoDB credentials not configured. In-memory test responses active.");
  }

  app.listen(PORT, () => {
    console.log(`Qavora backend server running on http://localhost:${PORT}`);
  });
}

startServer();
