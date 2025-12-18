import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });
dotenv.config();

// Secret key untuk JWT - dalam production gunakan environment variable
const JWT_SECRET =
  process.env.JWT_SECRET || "default-secret-key-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";

// User credentials - dalam production sebaiknya disimpan di database
// Load users from environment variables
interface UserCredential {
  id: number;
  username: string | undefined;
  password: string | undefined;
  role: string;
}

const USERS: UserCredential[] = [
  {
    id: 1,
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD_HASH,
    role: "admin",
  },
  {
    id: 2,
    username: process.env.USER_USERNAME,
    password: process.env.USER_PASSWORD_HASH,
    role: "user",
  },
];

export interface User {
  id: number;
  username: string;
  role: string;
}

export interface AuthPayload {
  userId: number;
  username: string;
  role: string;
}

/**
 * Generate JWT token untuk user
 */
export function generateToken(user: User): string {
  const payload: AuthPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token dan return payload
 */
export function verifyToken(token: string): AuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "object" && decoded !== null) {
      const payload = decoded as jwt.JwtPayload;
      if (payload.userId && payload.username && payload.role) {
        return {
          userId: payload.userId as number,
          username: payload.username as string,
          role: payload.role as string,
        };
      }
    }
    return null;
  } catch (error) {
    console.error("Token verification failed:", error);
    return null;
  }
}

/**
 * Authenticate user dengan username dan password
 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  const user = USERS.find((u) => u.username === username);

  if (!user || !user.username || !user.password) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

/**
 * Middleware untuk melindungi routes yang memerlukan autentikasi
 */
export function authMiddleware() {
  return async (c: any, next: any) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Missing or invalid authorization header",
        },
        401
      );
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const payload = verifyToken(token);

    if (!payload) {
      return c.json(
        { error: "Unauthorized", message: "Invalid or expired token" },
        401
      );
    }

    // Attach user info to context
    c.set("user", payload);
    await next();
  };
}

/**
 * Middleware untuk melindungi routes yang memerlukan admin role
 */
export function adminMiddleware() {
  return async (c: any, next: any) => {
    const user = c.get("user") as AuthPayload;

    if (!user || user.role !== "admin") {
      return c.json(
        { error: "Forbidden", message: "Admin access required" },
        403
      );
    }

    await next();
  };
}
