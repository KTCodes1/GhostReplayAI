// Decision DNA: how a player chooses. One meter per trait (a percentile among peers), the number
// beside it and the fact behind it in words, so nothing relies on the bar alone.

import type { DecisionDNA } from '@ghost/engine';

export function DnaView({ dna, compact }: { dna: DecisionDNA; compact?: boolean }) {
  return (
    <div className={`dna${compact ? ' compact' : ''}`}>
      <div className="dna-head">
        <span className="dna-style">{dna.style}</span>
        <span className="hint">
          {dna.decisions} decisions · {dna.matches} match{dna.matches === 1 ? '' : 'es'} · vs {dna.peers} players
        </span>
      </div>
      <span className="dna-note">Percentiles against the other simulated players in the same matches. Descriptive of these matches, not a verdict on the player.</span>
      {dna.traits.map((t) => (
        <div key={t.key} className="dna-row" title={t.detail}>
          <span className="dna-label">{t.label}</span>
          <span className="meter" role="meter" aria-valuenow={t.value} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.label}: ${t.value} of 100`}>
            <span style={{ width: `${t.value}%` }} />
            <i className="meter-mid" />
          </span>
          <b>{t.value}</b>
          {!compact && <span className="dna-detail">{t.detail}</span>}
        </div>
      ))}
    </div>
  );
}
