import fs from "node:fs"; const text = fs.readFileSync("openapi/openapi.yaml", "utf8"); if (!text.includes("openapi: 3.")) throw new Error("Not OpenAPI"); console.log("OpenAPI fixture detected");
