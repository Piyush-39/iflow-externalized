import express from "express";
import { createApiApp } from "./src/api/app.js";

const app = express();
app.use(createApiApp());

export default app;
