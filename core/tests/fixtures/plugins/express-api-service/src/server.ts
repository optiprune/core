import express from "express";
import { ordersRouter } from "./routes/orders";
import { health } from "./controllers/health";
import { authenticate, requestLogger } from "./middleware/authenticate";

const app = express();
app.use([authenticate, requestLogger]);
app.use("/orders", ordersRouter);
app.get("/health", health);
app.use("/legacy", require("./routes/legacy"));

export default app;
