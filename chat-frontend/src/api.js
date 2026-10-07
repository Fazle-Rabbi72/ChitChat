import axios from "axios";

export const getApiBaseUrl = () => {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("custom_api_url");
    if (custom) return custom.replace(/\/$/, "");
  }
  return (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
};

export const getWsBaseUrl = () => {
  if (typeof window !== "undefined") {
    const custom = localStorage.getItem("custom_api_url");
    if (custom) {
      const isHttps = custom.startsWith("https");
      const clean = custom.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return `${isHttps ? "wss" : "ws"}://${clean}/ws`;
    }
  }
  return import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";
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