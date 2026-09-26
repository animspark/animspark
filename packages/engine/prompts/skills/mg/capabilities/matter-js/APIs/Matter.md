# Matter

`import Matter from 'matter-js'`

| Item | Usage |
| --- | --- |
| Structure | At module top level: `Matter.Engine.create` → add bodies → loop `Engine.update(engine, 1000 / FPS)`, pushing each frame's `{ x, y, angle }` into an array. In the component, `const t = useLocal()` (`@animspark/runtime`), convert `t` to a frame index, look it up in the table and draw. Render only looks up the table and must not call `Engine.update` (the engine depends on history; scrubbing would continue integrating from the current world state). Do not use `Matter.Render` / `Matter.Runner` (they run their own wall-clock loop) |
| Table length | Cover the current scene's `durationSec` (seconds × FPS); past the end of the table, hold the last frame. For complex worlds, keep the body count and the precomputed duration under control |
| Alignment | When an event must land on a narration word: find that frame in the table (first ground contact = velocity reverses) and work back to the spawn height, or use the landing frame's time as the anchor |
| Shape | Bodies must match the drawn shapes (`Bodies.circle` with a circle, `Bodies.rectangle` with a rectangle, `Bodies.fromVertices` with a polygon), or objects look like they pass through each other; set the ground, spawn points and `viewBox` to the frame size given by the task |

The `Example` below can go into the current MG scene as a child component.

```tsx
import Matter from 'matter-js';
import { useLocal } from '@animspark/runtime';


const FPS = 60, FRAMES = 4 * FPS;
const engine = Matter.Engine.create({ gravity: { x: 0, y: 1 } });
const boxes = [
  Matter.Bodies.rectangle(860, -60, 120, 120, { restitution: 0.6 }),
  Matter.Bodies.circle(1120, -600, 55, { restitution: 0.8 }),
];
Matter.Composite.add(engine.world, [...boxes, Matter.Bodies.rectangle(960, 1050, 1920, 100, { isStatic: true })]);
const table: Array<Array<{ x: number; y: number; a: number }>> = [];
for (let i = 0; i <= FRAMES; i++) {
  table.push(boxes.map((b) => ({ x: b.position.x, y: b.position.y, a: b.angle })));
  if (i < FRAMES) Matter.Engine.update(engine, 1000 / FPS);
}
Matter.Composite.clear(engine.world, false);
Matter.Engine.clear(engine);
const poseAt = (sec: number) => table[Math.max(0, Math.min(FRAMES, Math.floor(sec * FPS)))]!;
const place = (p: { x: number; y: number; a: number }) => `translate(${p.x} ${p.y}) rotate(${p.a * 180 / Math.PI})`;

export function Example() {
  const [box, ball] = poseAt(useLocal());
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <rect x={-60} y={-60} width={120} height={120} rx={10} fill="#c6f24e" transform={place(box!)} />
      <circle r={55} fill="#4f7cff" transform={place(ball!)} />
    </svg>
  );
}
```
