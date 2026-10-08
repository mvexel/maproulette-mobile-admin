/** The app (vite preview) and the mock backend used by the end-to-end tests. Ports can be overridden when the defaults are taken. */
const appPort = process.env.E2E_APP_PORT ?? "4173";
const mockPort = process.env.E2E_MOCK_PORT ?? "9300";
export const APP = `http://localhost:${appPort}`;
export const MOCK = `http://127.0.0.1:${mockPort}`;
export const PORTS = { app: appPort, mock: mockPort };
