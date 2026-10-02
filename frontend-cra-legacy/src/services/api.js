import axios from 'axios';

// Baked in at build time by CRA (REACT_APP_ prefix is required). Defaults to
// the local compose setup so `docker compose up` still works with no config.
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// No auth interceptor: this instance is single-user and local-only, so there is
// no token to attach and no session to expire.
const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export default apiClient;
