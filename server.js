import express from "express";

const app = express();

const PORT = 5000;

app.listen(PORT, () => {
  console.log(`Qavora backend server running on http://localhost:${PORT}`);
});