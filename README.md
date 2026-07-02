# Futebol 3D

Jogo de futebol 3D com React Three Fiber, física Rapier e modelos GLB.

## Como rodar

```bash
npm install
npm run dev
```

## Controles

- **WASD** — mover jogador
- **Shift** — correr
- **E** — passe
- **Espaço** — chute / saída de bola

## Modelos

Coloque os arquivos em `public/models/`:

- `field.glb` — campo (field_area, ball_spawn, gol_01, gol_02)
- `player.glb` — jogador (animações: idle, run, pass, kick)
- `ball.glb` — bola

## Regras implementadas

- Tempo de jogo (2 tempos de 45 min acelerados)
- Gols com detecção nos volumes gol_01 / gol_02
- Laterais (throw-in)
- Escanteios
- Tiro de meta
- Saída de bola no centro
- Intervalo e fim de jogo
