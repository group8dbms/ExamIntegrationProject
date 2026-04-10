export const API_BASE = "http://127.0.0.1:4000";

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(data.message || data || "Request failed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}
