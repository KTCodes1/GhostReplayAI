import { Html, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { type GhostOption, type MatchEvent, type Side, type Vec2, clamp, optionKey, toAbsolute } from '@ghost/engine';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useMatch } from '../store';
import { toWorld } from './coords';

const GHOST = '#5b9cf5';
const ACTUAL = '#ef7a6b';
const ALT = '#8b95a3';
const H = 0.35;

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
function TargetZone({ at, opacity }: { at: Vec2; opacity: number }) {
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
        <meshBasicMaterial color={GHOST} transparent opacity={0.12 * opacity} depthWrite={false} />
      </mesh>
      <Line points={edge} color={GHOST} lineWidth={1} dashed dashSize={0.8} gapSize={0.6} transparent opacity={opacity} />
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

export function Ghosts() {
  const ghost = useMatch((s) => s.ghost);
  const playing = useMatch((s) => s.whatIfPlaying);
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
  const start = toAbsolute(event.start, team);
  const end = (o: GhostOption) => toAbsolute(o.end, team);
  const all = [moment.actual, moment.ghost, ...moment.alternatives];

  // While a what-if plays, only keep a faint trace of the option being simulated.
  if (playing) {
    const o = all.find((x) => optionKey(x) === playing);
    return o ? <Arrow from={start} to={end(o)} color={o === moment.actual ? ACTUAL : GHOST} width={2} dashed opacity={0.45} /> : null;
  }

  const actualEnd = event.end ? toAbsolute(event.end, team) : end(moment.actual);
  const ghostEnd = end(moment.ghost);
  const ghostKey = optionKey(moment.ghost);
  const others = moment.alternatives.filter((o) => optionKey(o) !== ghostKey).slice(0, 3);
  const ghostTarget = frozenPos(event, moment.ghost.targetPlayerId);
  const actualTarget = frozenPos(event, moment.actual.targetPlayerId);

  return (
    <group>
      {grow > 0 && <TargetZone at={ghostEnd} opacity={grow} />}
      <Ring at={start} color={GHOST} r={1.5} />
      {actualTarget && <Ring at={actualTarget} color={ACTUAL} r={1.4} />}
      {ghostTarget && grow > 0.95 && <Ring at={ghostTarget} color={GHOST} r={1.6} />}

      <Arrow from={start} to={actualEnd} color={ACTUAL} width={3} />
      {others.map((o, i) => (
        <Arrow key={i} from={start} to={end(o)} color={ALT} width={1.5} dashed opacity={0.8 * grow} grow={grow} />
      ))}
      <Arrow from={start} to={ghostEnd} color={GHOST} width={4} grow={grow} />

      <Html position={toWorld(actualEnd, 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <div className="tag tag-actual">CHOSEN · {label(moment.actual)}</div>
      </Html>
      {grow > 0.95 && (
        <Html position={toWorld(ghostEnd, 2.2)} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="tag tag-ghost">
            BETTER · {label(moment.ghost)} · +{moment.evLost.toFixed(3)} EV
          </div>
        </Html>
      )}
    </group>
  );
}
