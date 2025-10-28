// API Configuration
const API_CONFIG = {
  // Determine API base URL based on environment
  getBaseUrl() {
    const hostname = window.location.hostname;
    const port = window.location.port;

    // Production (Vercel)
    if (hostname.includes("vercel.app") || hostname.includes("vercel.com")) {
      return window.location.origin; // Same origin as frontend
    }

    // Development (Local)
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "http://localhost:3000"; // API server port
    }

    // Fallback to same origin
    return window.location.origin;
  },

  // Get full API URL
  getApiUrl(endpoint) {
    const baseUrl = this.getBaseUrl();
    return `${baseUrl}${endpoint}`;
  },
};

// Authentication utilities for protected pages
const Auth = {
  // Get token from localStorage
  getToken() {
    return localStorage.getItem("auth_token");
  },

  // Save token to localStorage
  setToken(token) {
    localStorage.setItem("auth_token", token);
  },

  // Remove token from localStorage
  removeToken() {
    localStorage.removeItem("auth_token");
  },

  // Check if user is authenticated
  isAuthenticated() {
    const token = this.getToken();
    if (!token) return false;

    try {
      // Decode JWT token to check expiration
      const payload = JSON.parse(atob(token.split(".")[1]));
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch (error) {
      return false;
    }
  },

  // Get user info from token
  getUserInfo() {
    const token = this.getToken();
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      return {
        userId: payload.userId,
        username: payload.username,
        role: payload.role,
      };
    } catch (error) {
      return null;
    }
  },

  // Redirect to login if not authenticated
  requireAuth() {
    if (!this.isAuthenticated()) {
      const currentPath = window.location.pathname;
      window.location.href = `/login?return=${encodeURIComponent(currentPath)}`;
      return false;
    }
    return true;
  },

  // Logout user
  logout() {
    this.removeToken();
    window.location.href = "/login";
  },

  // Add authorization header to fetch requests
  getAuthHeaders() {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  },

  // Make authenticated fetch request with proper API URL
  async authenticatedFetch(endpoint, options = {}) {
    const authHeaders = this.getAuthHeaders();
    const url = API_CONFIG.getApiUrl(endpoint);

    console.log(`🔗 Making API request to: ${url}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    });

    // If unauthorized, redirect to login
    if (response.status === 401) {
      this.logout();
      return null;
    }

    return response;
  },

  // Login method with proper API URL
  async login(username, password) {
    const url = API_CONFIG.getApiUrl("/api/auth/login");

    console.log(`🔐 Attempting login to: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return await response.json();
  },
};

// Auto-redirect logic based on current page
document.addEventListener("DOMContentLoaded", () => {
  const currentPath = window.location.pathname;

  // If on login page, redirect to dashboard if already authenticated
  if (currentPath === "/login" || currentPath.includes("/login")) {
    Auth.redirectIfAuthenticated();
    return;
  }

  // For other pages, require authentication
  Auth.requireAuth();
});

// Add logout functionality to any element with class 'logout-btn'
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("logout-btn")) {
    e.preventDefault();
    Auth.logout();
  }
});

// Export for use in other scripts
window.Auth = Auth;
window.API_CONFIG = API_CONFIG;
