/**
 * A9.18: el juego habla con el save-server (partidas en la nube, leaderboard, telemetría y estadísticas) por el proxy
 * de MISMO ORIGEN `/save-api/<ruta>` del propio dominio del juego. Así no depende de otro dominio que un operador pueda
 * bloquear, no hay CORS ni preflight y vale igual en cualquier vhost del juego. En `vite dev`/`vite preview` lo
 * atiende el proxy de vite.config.ts.
 */
export const SAVE_API = '/save-api';
