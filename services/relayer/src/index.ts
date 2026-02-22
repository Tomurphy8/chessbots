import Fastify from "fastify";
import cors from "@fastify/cors";
import { CONFIG } from "./config.js";
import { Relayer, RelayError, type ForwardRequest } from "./relay.js";
import { getAddress, isAddress } from "viem";

// ── Bootstrap ───────────────────────────────────────────────────────────────

const server = Fastify({
  logger: {
    level: "info",
    transport: {
      target: "pino-pretty",
      options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
    },
  },
});

await server.register(cors, {
  origin: [
    "https://chessbots.io",
    "https://www.chessbots.io",
    /^http:\/\/localhost(:\d+)?$/,
  ],
});

const relayer = new Relayer();

// ── Request / response schemas ──────────────────────────────────────────────

interface RelayBody {
  request: {
    from: string;
    to: string;
    value: string;
    gas: string;
    nonce: string;
    deadline: number;
    data: string;
  };
  signature: string;
}

interface NonceParams {
  address: string;
}

// ── Routes ──────────────────────────────────────────────────────────────────

server.post<{ Body: RelayBody }>("/relay", async (req, reply) => {
  const { request, signature } = req.body;

  // Validate payload shape
  if (!request || !signature) {
    return reply.status(400).send({ error: "Missing request or signature" });
  }

  const requiredFields = ["from", "to", "value", "gas", "nonce", "deadline", "data"] as const;
  for (const field of requiredFields) {
    if (request[field] === undefined || request[field] === null) {
      return reply.status(400).send({ error: `Missing required field: request.${field}` });
    }
  }

  // Validate addresses
  if (!isAddress(request.from)) {
    return reply.status(400).send({ error: "Invalid from address" });
  }
  if (!isAddress(request.to)) {
    return reply.status(400).send({ error: "Invalid to address" });
  }

  // Validate signature format
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) {
    return reply.status(400).send({ error: "Invalid signature format" });
  }

  // Parse the forward request
  let forwardRequest: ForwardRequest;
  try {
    forwardRequest = {
      from: getAddress(request.from),
      to: getAddress(request.to),
      value: BigInt(request.value),
      gas: BigInt(request.gas),
      nonce: BigInt(request.nonce),
      deadline: Number(request.deadline),
      data: request.data as `0x${string}`,
    };
  } catch (err) {
    return reply.status(400).send({
      error: `Invalid request parameters: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  try {
    const result = await relayer.relay(forwardRequest, signature as `0x${string}`);
    return reply.status(200).send(result);
  } catch (err) {
    if (err instanceof RelayError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    req.log.error(err, "Unexpected relay error");
    return reply.status(500).send({ error: "Internal relay error" });
  }
});

server.get<{ Params: NonceParams }>("/nonce/:address", async (req, reply) => {
  const { address } = req.params;

  if (!isAddress(address)) {
    return reply.status(400).send({ error: "Invalid address" });
  }

  try {
    const nonce = await relayer.getNonce(getAddress(address));
    return reply.status(200).send({ nonce: nonce.toString() });
  } catch (err) {
    req.log.error(err, "Failed to fetch nonce");
    return reply.status(502).send({ error: "Failed to fetch nonce from chain" });
  }
});

server.get("/health", async (_req, reply) => {
  return reply.status(200).send({
    status: "ok",
    address: relayer.walletAddress,
    forwarder: CONFIG.forwarderAddress,
    chainId: CONFIG.chainId,
  });
});

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  server.log.info(`Received ${signal}, shutting down...`);
  relayer.destroy();
  await server.close();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Start ───────────────────────────────────────────────────────────────────

try {
  await server.listen({ port: CONFIG.port, host: "0.0.0.0" });
  server.log.info(
    `Relayer listening on port ${CONFIG.port} | wallet=${relayer.walletAddress} | forwarder=${CONFIG.forwarderAddress}`,
  );
} catch (err) {
  server.log.fatal(err, "Failed to start relayer");
  process.exit(1);
}
