import { Html, Line } from '@react-three/drei';
import { type ThreeEvent, useFrame } from '@react-three/fiber';
import { type DecisionMoment, type GhostOption, type GhostTree, type MatchEvent, type Side, type Vec2, clamp, optionKey, toAbsolute } from '@ghost/engine';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useMatch } from '../store';
import { predictOptions } from '../ui/GhostPanel';
import { toWorld } from './coords';

const GHOST = '#5b9cf5';
const ACTUAL = '#ef7a6b';
const ALT = '#8b95a3';
const GENIUS = '#4cbb83';
const SKETCH = '#e6e8eb';
const H = 0.35;
const LETTERS = 'ABCDEF';

function Arrow({ from, to, color, width, dashed, grow = 1, opacity = 1 }: { from: Vec2; to: Vec2; color: string; width: number; dashed?: boolean; grow?: number; opacity?: number }) {
  const end = { x: from.x + (to.x - from.x) * grow, y: from.y + (to.y - from.y) * grow };
  const a = toWorld(from, H);
  const b = toWorld(end, H);
  const dir = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]);
  const len = dir.length();
  const quat = useMemo(() => new THREE.Quaternion(), []);
  if (len > 0.01) quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  if (len < 0.5) return null;
  return (
    <group>
      <Line points={[a, b]} color={color} lineWidth={width} dashed={dashed} dashSize={1.2} gapSize={0.8} transparent opacity={opacity} />
      <mesh position={b} quaternion={quat}>
        <coneGeometry args={[0.35 + width * 0.12, 1.4 + width * 0.2, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

function Ring({ at, color, r = 1.6 }: { at: Vec2; color: string; r?: number }) {
  return (
    <mesh position={toWorld(at, 0.1)} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[r, r + 0.25, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} />
    </mesh>
  );
}

/** Translucent box with a dashed edge marking the space the better option goes into. */
function TargetZone({ at, opacity, color = GHOST }: { at: Vec2; opacity: number; color?: string }) {
  const w = 12;
  const h = 10;
  const x0 = clamp(at.x - w / 2, 0, 105 - w);
  const y0 = clamp(at.y - h / 2, 0, 68 - h);
  const edge = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
    [x0, y0],
  ].map(([x, y]) => toWorld({ x: x!, y: y! }, 0.05));
  return (
    <group>
      <mesh position={toWorld({ x: x0 + w / 2, y: y0 + h / 2 }, 0.04)} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color={color} transparent opacity={0.12 * opacity} depthWrite={false} />
      </mesh>
      <Line points={edge} color={color} lineWidth={1} dashed dashSize={0.8} gapSize={0.6} transparent opacity={opacity} />
    </group>
  );
}

/**
 * What the player could see: a clear-sight wedge and fainter edge-of-vision wedges, drawn flat on the
 * grass. A flat circle sector's local (x, y) maps to pitch (x, y) once rotated onto the ground.
 */
function VisionCone({ at, facing, centralDeg, peripheralDeg }: { at: Vec2; facing: Vec2; centralDeg: number; peripheralDeg: number }) {
  const a = Math.atan2(facing.y, facing.x);
  const c = (centralDeg * Math.PI) / 180;
  const p = (peripheralDeg * Math.PI) / 180;
  const R = 26;
  const pos = toWorld(at, 0.025);
  const edge = (ang: number) => [toWorld(at, 0.03), toWorld({ x: at.x + Math.cos(ang) * R, y: at.y + Math.sin(ang) * R }, 0.03)];
  return (
    <group>
      <mesh position={pos} rotation-x={-Math.PI / 2} renderOrder={1}>
        <circleGeometry args={[R, 48, a - c, 2 * c]} />
        <meshBasicMaterial color={GHOST} transparent opacity={0.09} depthWrite={false} />
      </mesh>
      {[
        [a + c, p - c],
        [a - p, p - c],
      ].map(([start, len], i) => (
        <mesh key={i} position={pos} rotation-x={-Math.PI / 2} renderOrder={1}>
          <circleGeometry args={[R, 32, start, len]} />
          <meshBasicMaterial color={GHOST} transparent opacity={0.035} depthWrite={false} />
        </mesh>
      ))}
      {[a - c, a + c].map((ang, i) => (
        <Line key={i} points={edge(ang)} color={GHOST} lineWidth={1} dashed dashSize={0.6} gapSize={0.6} transparent opacity={0.45} />
      ))}
    </group>
  );
}

/** Branching outcomes on the pitch: where the follow-up shot comes from, and where the ball is lost. */
function TreePaths({ from, end, tree, team, color }: { from: Vec2; end: Vec2; tree: GhostTree; team: Side; color: string }) {
  const shotFrom = tree.shotFrom ? toAbsolute(tree.shotFrom, team) : undefined;
  const lossAt = tree.lossAt ? toAbsolute(tree.lossAt, team) : undefined;
  const goal = team === 'home' ? { x: 105, y: 34 } : { x: 0, y: 34 };
  const ownGoal = team === 'home' ? { x: 0, y: 34 } : { x: 105, y: 34 };
  const shot = tree.arrive * tree.thenShot;
  return (
    <group>
      {shotFrom && shot > 0.03 && (
        <>
          <Line points={[toWorld(end, 0.2), toWorld(shotFrom, 0.2)]} color={color} lineWidth={1.2} dashed dashSize={0.5} gapSize={0.5} transparent opacity={0.35 + shot} />
          <Line points={[toWorld(shotFrom, 0.2), toWorld({ x: shotFrom.x + (goal.x - shotFrom.x) * 0.5, y: shotFrom.y + (goal.y - shotFrom.y) * 0.5 }, 0.2)]} color={color} lineWidth={1} transparent opacity={0.3 + shot} />
          <Html position={toWorld(shotFrom, 1.6)} center zIndexRange={[19, 10]} style={{ pointerEvents: 'none' }}>
            <div className="tag tag-tree">{Math.round(shot * 100)}% shot</div>
          </Html>
        </>
      )}
      {lossAt && tree.arrive < 0.97 && (
        <>
          <Line points={[toWorld(from, 0.2), toWorld(lossAt, 0.2)]} color={ACTUAL} lineWidth={1} dashed dashSize={0.4} gapSize={0.6} transparent opacity={0.25 + (1 - tree.arrive) * 0.5} />
          {tree.counterShot > 0.02 && (
            <Arrow from={lossAt} to={{ x: lossAt.x + (ownGoal.x - lossAt.x) * 0.35, y: lossAt.y + (ownGoal.y - lossAt.y) * 0.35 }} color={ACTUAL} width={1.2} dashed opacity={0.4 + tree.counterShot} />
          )}
          <Html position={toWorld(lossAt, 1.6)} center zIndexRange={[19, 10]} style={{ pointerEvents: 'none' }}>
            <div className="tag tag-tree bad">
              {Math.round((1 - tree.arrive) * 100)}% cut out{tree.counterShot > 0.02 ? ` · ${Math.round(tree.counterShot * 100)}% counter` : ''}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** Sketch mode: click the pitch to draw an option; an arrow follows the pointer. */
function SketchSurface({ from }: { from: Vec2 }) {
  const sketchAt = useMatch((s) => s.sketchAt);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const toPitch = (e: ThreeEvent<PointerEvent>): Vec2 => ({ x: clamp(e.point.x + 52.5, 0.5, 104.5), y: clamp(34 - e.point.z, 0.5, 67.5) });
  return (
    <group>
      <mesh
        position={[0, 0.06, 0]}
        rotation-x={-Math.PI / 2}
        onPointerMove={(e) => setHover(toPitch(e))}
        onPointerOut={() => setHover(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          sketchAt(toPitch(e));
        }}
      >
        <planeGeometry args={[110, 74]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hover && <Arrow from={from} to={hover} color={SKETCH} width={2.5} dashed opacity={0.8} />}
    </group>
  );
}

const label = (o: GhostOption) =>
  o.action === 'shot' ? `shot · ${Math.round(o.pSuccess * 100)}% to score` : `${Math.round(o.pSuccess * 100)}% · xT ${o.valueIfSuccess.toFixed(2)}`;

/** Absolute position of a player in the frozen moment. */
function frozenPos(event: MatchEvent, id?: string): Vec2 | undefined {
  const s = id ? event.freezeFrame.find((f) => f.playerId === id) : undefined;
  return s ? toAbsolute(s.pos, event.team) : undefined;
}

/** "You're the player": every option as a neutral, lettered arrow, nothing given away. */
function PredictArrows({ moment, start }: { moment: DecisionMoment; start: Vec2 }) {
  const end = (o: GhostOption) => toAbsolute(o.end, moment.team);
  return (
    <group>
      <Ring at={start} color={GHOST} r={1.5} />
      {predictOptions(moment).map((o, i) => (
        <group key={optionKey(o)}>
          <Arrow from={start} to={end(o)} color={SKETCH} width={2} opacity={0.75} />
          <Html position={toWorld(end(o), 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
            <div className="tag tag-letter">{LETTERS[i]}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

export function Ghosts() {
  const ghost = useMatch((s) => s.ghost);
  const playing = useMatch((s) => s.whatIfPlaying);
  const comparing = useMatch((s) => s.comparing);
  const results = useMatch((s) => s.whatIf);
  const predictMode = useMatch((s) => s.predictMode);
  const voted = useMatch((s) => (s.ghost ? !!s.myVotes[s.ghost.moment.eventId] : false));
  const sketching = useMatch((s) => s.sketching);
  const sketches = useMatch((s) => (s.ghost ? s.sketches[s.ghost.moment.eventId] ?? [] : []));
  const [grow, setGrow] = useState(0);
  const key = ghost?.moment.eventId;
  const startedFor = useRef<string | undefined>(undefined);
  const t0 = useRef(0);
  useFrame(({ clock }) => {
    if (!key) return;
    if (startedFor.current !== key) {
      startedFor.current = key;
      t0.current = clock.elapsedTime;
    }
    // Delay so the camera swoops first, then the ghost draws itself in.
    const g = Math.min(1, Math.max(0, (clock.elapsedTime - t0.current - 0.6) / 0.7));
    if (g !== grow) setGrow(g);
  });
  if (!ghost) return null;

  const { moment, event } = ghost;
  const team: Side = moment.team;
  const genius = moment.kind === 'genius';
  const start = toAbsolute(event.start, team);
  const end = (o: GhostOption) => toAbsolute(o.end, team);
  const all = [moment.actual, moment.ghost, ...moment.alternatives, ...sketches.map((x) => x.verdict.option)];
  const facing = moment.vision ? (team === 'home' ? moment.vision.facing : { x: -moment.vision.facing.x, y: -moment.vision.facing.y }) : undefined;
  const cone = facing && moment.vision && <VisionCone at={start} facing={facing} centralDeg={moment.vision.centralDeg} peripheralDeg={moment.vision.peripheralDeg} />;

  // What-if timeline: just faint traces of the two options while both versions play.
  if (comparing)
    return (
      <group>
        <Arrow from={start} to={event.end ? toAbsolute(event.end, team) : end(moment.actual)} color={genius ? GENIUS : ACTUAL} width={2} dashed opacity={0.4} />
        <Arrow from={start} to={end(moment.ghost)} color={genius ? ALT : GHOST} width={2} dashed opacity={0.4} />
      </group>
    );
  // While a what-if plays, only keep a faint trace of the option being simulated.
  if (playing) {
    const o = all.find((x) => optionKey(x) === playing);
    const isSketch = sketches.some((x) => x.whatif.key === playing);
    return o ? <Arrow from={start} to={end(o)} color={isSketch ? SKETCH : o === moment.actual ? (genius ? GENIUS : ACTUAL) : GHOST} width={2} dashed opacity={0.45} /> : null;
  }

  if (predictMode && !voted)
    return (
      <group>
        {cone}
        <PredictArrows moment={moment} start={start} />
      </group>
    );

  const actualEnd = event.end ? toAbsolute(event.end, team) : end(moment.actual);
  const ghostEnd = end(moment.ghost);
  const ghostKey = optionKey(moment.ghost);
  const others = moment.alternatives.filter((o) => optionKey(o) !== ghostKey).slice(0, 3);
  const ghostTarget = frozenPos(event, moment.ghost.targetPlayerId);
  const actualTarget = frozenPos(event, moment.actual.targetPlayerId);
  // The headline option's outcome tree: the better option for a miss, the find for a genius moment.
  const headline = genius ? moment.actual : moment.ghost;
  const tree = results[optionKey(headline)]?.summary.tree;

  return (
    <group>
      {cone}
      {grow > 0 && <TargetZone at={genius ? actualEnd : ghostEnd} opacity={grow} color={genius ? GENIUS : GHOST} />}
      <Ring at={start} color={genius ? GENIUS : GHOST} r={1.5} />
      {actualTarget && <Ring at={actualTarget} color={genius ? GENIUS : ACTUAL} r={1.4} />}
      {ghostTarget && grow > 0.95 && <Ring at={ghostTarget} color={genius ? ALT : GHOST} r={1.6} />}

      {genius ? (
        <>
          <Arrow from={start} to={ghostEnd} color={ALT} width={2} dashed grow={grow} opacity={0.8} />
          <Arrow from={start} to={actualEnd} color={GENIUS} width={4} />
        </>
      ) : (
        <>
          <Arrow from={start} to={actualEnd} color={ACTUAL} width={3} />
          {others.map((o, i) => (
            <Arrow key={i} from={start} to={end(o)} color={ALT} width={1.5} dashed opacity={0.8 * grow} grow={grow} />
          ))}
          <Arrow from={start} to={ghostEnd} color={GHOST} width={4} grow={grow} />
        </>
      )}
      {tree && grow > 0.95 && <TreePaths from={start} end={genius ? actualEnd : ghostEnd} tree={tree} team={team} color={genius ? GENIUS : GHOST} />}

      {sketches.map((x) => (
        <group key={x.whatif.key}>
          <Arrow from={start} to={end(x.verdict.option)} color={SKETCH} width={2.5} dashed />
          <Html position={toWorld(end(x.verdict.option), 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
            <div className="tag tag-sketch">
              SKETCH · #{x.verdict.rank} of {x.verdict.of} · {x.verdict.option.deltaVsActual >= 0 ? '+' : ''}
              {x.verdict.option.deltaVsActual.toFixed(3)}
            </div>
          </Html>
        </group>
      ))}
      {sketching && <SketchSurface from={start} />}

      <Html position={toWorld(actualEnd, 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className={`tag ${genius ? 'tag-genius' : 'tag-actual'}`}>
          {genius ? 'FOUND' : 'CHOSEN'} · {label(moment.actual)}
        </div>
      </Html>
      {grow > 0.95 && (
        <Html position={toWorld(ghostEnd, 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className={`tag ${genius ? 'tag-obvious' : 'tag-ghost'}`}>
            {genius ? `OBVIOUS · ${label(moment.ghost)}` : `BETTER · ${label(moment.ghost)} · +${moment.evLost.toFixed(3)} EV`}
          </div>
        </Html>
      )}
    </group>
  );
}
