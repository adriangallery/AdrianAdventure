// F1.2 (plan FUNTICO_ADVENTURE): corte del nombre del jugador en las listas (Hall of Fame). Puro (tests de Node).
/** Nombre en `chars` caracteres como mucho: si no cabe, se corta (sin espacios ni puntuación colgando) y lleva «..». */
export function fitName(name: string, chars: number): string {
  if (name.length <= chars) return name;
  let cut = name.slice(0, Math.max(1, chars - 2));
  const sp = cut.lastIndexOf(' ');
  if (sp >= chars / 2) cut = cut.slice(0, sp); // «Test Pilot #9950» → «Test Pilot..», no «Test Pilot #9..»
  return cut.replace(/[\s#.,:;_-]+$/, '') + '..';
}
