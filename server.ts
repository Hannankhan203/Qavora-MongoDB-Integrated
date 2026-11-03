import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// MongoDB connection handling with safe fallback
let db: any = null;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (uri && dbName) {
  try {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
    client.connect()
      .then(() => {
        db = client.db(dbName);
        console.log(`Successfully connected to MongoDB Atlas (database: ${dbName}).`);
      })
      .catch((error: any) => {
        const safeErrorMessage = (error?.message || "Unknown error").replace(
          /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
          "mongodb+srv://[credentials-hidden]@"
        );
        console.warn(`[AI Studio] MongoDB connection offline: ${safeErrorMessage}. Fallback mock active.`);
      });
  } catch (err: any) {
    console.warn(`[AI Studio] Could not initialize MongoDB client: ${err?.message}`);
  }
} else {
  console.log('[AI Studio] MongoDB credentials not provided in environment; using in-memory mock responses.');
}

// Default mock tests for QA verification
const mockTests = [
  { _id: "qav-test-001", name: "User Registration & Form Validation", status: "Passed" },
  { _id: "qav-test-002", name: "Authentication Session Expiry Check", status: "Active" },
  { _id: "qav-test-003", name: "Manual Test Suite Export & Import", status: "Passed" },
  { _id: "qav-test-004", name: "Cross-Device Checklist Synchronization", status: "Active" },
  { _id: "qav-test-005", name: "Defect Logging & Severity Assignment", status: "Passed" }
];

// Health check endpoint
app.get("/api/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Qavora backend is running successfully.",
    database: db ? "connected" : "mock-active"
  });
});

// GET /api/tests endpoint - Fetch all documents from the 'tests' collection
app.get("/api/tests", async (req: Request, res: Response) => {
  try {
    if (db) {
      const tests = await db.collection("tests").find({}).toArray();
      return res.json(tests);
    }
    return res.json(mockTests);
  } catch (error: any) {
    const safeError = (error?.message || "Internal server error").replace(
      /mongodb(?:\+srv)?:\/\/[^@\s]+@/gi,
      "mongodb+srv://[credentials-hidden]@"
    );
    console.warn(`[AI Studio] Error querying tests collection: ${safeError}. Returning mock data.`);
    return res.json(mockTests);
  }
});

// POST /api/tests endpoint - Save a new test document to the 'tests' collection
app.post("/api/tests", async (req: Request, res: Response) => {
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
  } catch (error: any) {
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

// Route-level fallback for database errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.name === 'MongooseError' || err?.name === 'MongoNetworkError' || (err?.message && err.message.includes('buffering timed out'))) {
    console.warn('[AI Studio] Database offline — returning mock empty response');
    if (req.method === 'GET') {
      return res.json(req.path.endsWith('s') || req.path.endsWith('s/') ? [] : {});
    }
    return res.status(503).json({ error: 'Service temporarily unavailable (database offline)' });
  }
  next(err);
});

async function setupServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Qavora server running on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
