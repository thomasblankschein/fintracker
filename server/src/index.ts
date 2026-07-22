import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import swaggerUi from "swagger-ui-express";
import "./db.js";
import { seedIfEmpty } from "./seed.js";
import { accountsRouter } from "./routes/accounts.js";
import { payeesRouter } from "./routes/payees.js";
import { transactionsRouter } from "./routes/transactions.js";
import { recurringRouter } from "./routes/recurring.js";
import { forecastRouter } from "./routes/forecast.js";
import { reportsRouter } from "./routes/reports.js";
import { importRouter } from "./routes/import.js";
import { importTemplatesRouter } from "./routes/importTemplates.js";

seedIfEmpty();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openapiSpec = yaml.load(
  fs.readFileSync(path.resolve(__dirname, "../openapi.yaml"), "utf-8")
) as swaggerUi.JsonObject;

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api-docs.json", (req, res) => res.json(openapiSpec));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));

app.use("/api/accounts", accountsRouter);
app.use("/api/payees", payeesRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/recurring", recurringRouter);
app.use("/api/forecast", forecastRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/import", importRouter);
app.use("/api/import-templates", importTemplatesRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? "Interner Fehler" });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
  console.log(`API-Doku (Swagger UI) auf http://localhost:${PORT}/api-docs`);
});
