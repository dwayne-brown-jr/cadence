import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  // On long-running hosts (Fly.io, Railway, Render, local dev) keep the
  // libsql:// WebSocket transport — connection reuse is a major latency win.
  // On serverless (Netlify/Vercel functions) downgrade to HTTPS because
  // serverless invocations can't hold persistent WebSocket connections.
  const rawUrl = process.env.DATABASE_URL!;
  // NETLIFY is only guaranteed at build time; Netlify functions run on Lambda.
  const isServerless =
    !!process.env.NETLIFY || !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  const url = isServerless
    ? rawUrl.replace(/^libsql:\/\//, "https://")
    : rawUrl;

  const adapter = new PrismaLibSql({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
