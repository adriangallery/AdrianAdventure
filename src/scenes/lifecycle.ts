import Phaser from 'phaser';

/**
 * A1.10: Phaser no llama por su cuenta al método `shutdown()` de una escena; hay que engancharlo al evento
 * SHUTDOWN, que salta en cada `scene.stop`/`scene.start` de otra escena. Los emisores de la escena (`scene.events`)
 * sobreviven a stop/start, así que se quita antes un enganche previo para no duplicarlo si `create()` se repite.
 *
 * Ojo: los plugins de la escena (cámaras, lista de objetos, tweens, relojes, input) escuchan SHUTDOWN desde que
 * arranca la escena, antes que `create()`, así que cuando llega este `shutdown()` ya han destruido sus objetos y
 * `cameras.main` ya no existe. El `shutdown()` de cada escena tiene que ser idempotente y no depender de ellos:
 * su trabajo es quitar lo que vive fuera de la escena (listeners del ScaleManager, que es global, de `window`,
 * `visualViewport`, wallet, temporizadores de `setTimeout`).
 *
 * DESTROY no se engancha: el juego nunca destruye escenas (no hay `game.destroy()`) y todo lo que crean estas
 * escenas se crea en `create()`, así que se limpia en SHUTDOWN.
 */
export function bindShutdown(scene: Phaser.Scene & { shutdown(): void }): void {
  const events = scene.events;
  events.off(Phaser.Scenes.Events.SHUTDOWN, scene.shutdown, scene);
  events.once(Phaser.Scenes.Events.SHUTDOWN, scene.shutdown, scene);
}
