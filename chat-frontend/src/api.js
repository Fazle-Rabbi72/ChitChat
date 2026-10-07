import axios from "axios";

export const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("custom_api_url");
    if (custom) return custom.replace(/\/$/, "");
  }
  return (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
};

export const getWsBaseUrl = () => {
  const apiBase = getApiBaseUrl();
  const isHttps = apiBase.startsWith("https");
  const clean = apiBase.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (import.meta.env.VITE_WS_URL && !localStorage.getItem("custom_api_url")) {
    return import.meta.env.VITE_WS_URL;
  }
  return `${isHttps ? "wss" : "ws"}://${clean}/ws`;
};

const API = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 10000,
});

API.interceptors.request.use((config) => {
  config.baseURL = getApiBaseUrl();
  return config;
});

export default API;