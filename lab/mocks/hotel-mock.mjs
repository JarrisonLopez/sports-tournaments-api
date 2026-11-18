import http from "node:http";

const port = Number(process.env.HOTEL_MOCK_PORT || 8081);
const delayMs = Number(process.env.HOTEL_MOCK_DELAY_MS || 0);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (delayMs > 0) {
    await new Promise((r) => setTimeout(r, delayMs));
  }

  if (url.pathname === "/health/live" || url.pathname === "/health/ready") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const match = url.pathname.match(/^\/api\/v2\/habitacion\/(\d+)$/);
  if (req.method === "GET" && match) {
    const id = Number(match[1]);
    res.writeHead(200, {
      "content-type": "application/json",
      "x-trace-id": req.headers["x-trace-id"] || "",
    });
    res.end(
      JSON.stringify({
        id,
        numeroHabitacion: String(100 + id),
        precioHabitacion: 100000,
        estadoHabitacion: "disponible",
        tipoHabitacion: "standard",
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`hotel-mock listening on http://127.0.0.1:${port}`);
});
