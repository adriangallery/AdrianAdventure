import { FailResponses, validateFailData, type FailResponsesData } from './FailResponses';
import raw from '../../assets/config/fail-responses.json';

/**
 * A2.5: respuestas de fallo del juego (una sola instancia para toda la partida: las bolsas recuerdan su última frase
 * entre escenas). Los datos van en el bundle (Vite importa el JSON al compilar). Con `?qa=1` la elección es determinista
 * (ronda desde 0 en cada bolsa) para que el walkthrough pueda comprobar el texto con `rejects`.
 */
const qa = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('qa') === '1';
const data = raw as unknown as FailResponsesData;

for (const problem of validateFailData(data)) console.warn(`[fail-responses] ${problem}`);

export const failResponses = new FailResponses(data, { deterministic: qa });
