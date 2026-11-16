import http from "node:http";

const port = Number(process.env.CINE_MOCK_PORT || 8082);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/v2/health" || url.pathname === "/health/live") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "v2" }));
    return;
  }

  const match = url.pathname.match(/^\/api\/v2\/peliculas\/(\d+)$/);
  if (req.method === "GET" && match) {
    const id = Number(match[1]);
    res.writeHead(200, {
      "content-type": "application/json",
      "x-trace-id": req.headers["x-trace-id"] || "",
    });
    res.end(
      JSON.stringify({
        id,
        nombre: `Pelicula ${id}`,
        duracion: 120,
        genero: "demo",
        descripcion: "mock local cine",
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ message: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`cine-mock listening on http://127.0.0.1:${port}`);
});
