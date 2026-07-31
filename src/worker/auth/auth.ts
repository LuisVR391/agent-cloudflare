import { betterAuth } from "better-auth";

import { createRateLimitStorage } from "../repositories/auth/rate-limit-storage";
import type { WorkerEnv } from "./types";

export function createAuth(
  env: WorkerEnv,
  requestOrigin: string,
  allowSignUp = false,
) {
  const baseURL = env.BETTER_AUTH_URL || requestOrigin;

  return betterAuth({
    appName: "Agent Cloudflare",
    baseURL,
    basePath: "/api/auth",
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [requestOrigin, baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 300, max: 3 },
      },
      customStorage: createRateLimitStorage(env.DB, env.BETTER_AUTH_SECRET),
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        status: {
          type: "string",
          required: true,
          defaultValue: "active",
          input: false,
        },
      },
    },
    session: {
      modelName: "user_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "user_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
  });
}
