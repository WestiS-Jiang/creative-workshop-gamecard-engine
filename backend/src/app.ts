import express from "express";
import cardRoutes from "./routes/card-routes";
import mapRoutes from "./routes/map-routes";
import reduceRoutes from "./routes/reduce-routes";
import turnRoutes from "./routes/turn-routes";
import visualRoutes from "./routes/visual-routes";

export function createApp() {
  const app = express();
  const jsonLimit = process.env.REQUEST_BODY_LIMIT ?? "20mb";

  app.use(express.json({ limit: jsonLimit }));

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "creative-workshop-backend",
      now: new Date().toISOString()
    });
  });

  app.use("/api/map", mapRoutes);
  app.use("/api/reduce", reduceRoutes);
  app.use("/api/turn", turnRoutes);
  app.use("/api/card", cardRoutes);
  app.use("/api/visual", visualRoutes);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isEntityTooLargeError(err)) {
      res.status(413).json({
        ok: false,
        error: `request entity too large (limit=${jsonLimit})`
      });
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown server error";
    res.status(500).json({
      ok: false,
      error: message
    });
  });

  return app;
}

function isEntityTooLargeError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const maybe = err as { type?: unknown; status?: unknown; statusCode?: unknown; message?: unknown };
  if (maybe.type === "entity.too.large") {
    return true;
  }

  return maybe.status === 413 || maybe.statusCode === 413 || maybe.message === "request entity too large";
}
