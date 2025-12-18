import { Hono } from "hono";
import { authenticateUser, generateToken } from "../auth.js";

const auth = new Hono();

/**
 * POST /api/auth/login - Login endpoint
 */
auth.post("/login", async (c) => {
  try {
    // Check Content-Type header
    const contentType = c.req.header("Content-Type");
    if (!contentType || !contentType.includes("application/json")) {
      return c.json(
        {
          error: "Bad Request",
          message: "Content-Type must be application/json",
        },
        400
      );
    }

    // Parse JSON with better error handling
    let body;
    try {
      body = await c.req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return c.json(
        { error: "Bad Request", message: "Invalid JSON format" },
        400
      );
    }

    const { username, password } = body;

    if (!username || !password) {
      return c.json(
        { error: "Bad Request", message: "Username and password are required" },
        400
      );
    }

    const user = await authenticateUser(username, password);

    if (!user) {
      return c.json(
        { error: "Unauthorized", message: "Invalid credentials" },
        401
      );
    }

    const token = generateToken(user);

    return c.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return c.json(
      { error: "Internal Server Error", message: "Login failed" },
      500
    );
  }
});

export default auth;

