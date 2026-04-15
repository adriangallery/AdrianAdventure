import Phaser from 'phaser';

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

void main() {
    float offset = 0.005;

    vec4 left = texture2D(uMainSampler, vec2(outTexCoord.x - offset, outTexCoord.y));
    vec4 right = texture2D(uMainSampler, vec2(outTexCoord.x + offset, outTexCoord.y));

    // Classic anaglyph: red from left eye, green+blue from right eye
    gl_FragColor = vec4(left.r, right.g, right.b, 1.0);
}
`;

export class AnaglyphPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game: Phaser.Game) {
    super({
      game,
      name: 'AnaglyphPipeline',
      fragShader: FRAG_SHADER,
    });
  }
}
