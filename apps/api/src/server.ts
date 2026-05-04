import http from "node:http";

const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ service: "agendaia-api" }));
});

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
