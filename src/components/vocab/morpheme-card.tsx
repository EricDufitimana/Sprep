import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardBody } from '@/components/ui/card';

export type Charge = 'positive' | 'negative' | 'neutral';
export type MorphemeType = 'root' | 'prefix' | 'suffix';

export interface MorphemeCardData {
  id: string;
  type: MorphemeType;
  text: string;
  meaning: string;
  charge: Charge | null;
  exampleWords: string[];
}

/** Charge → the app's pill colors, same mapping the ChargePicker uses. */
const CHARGE_TONE: Record<Charge, BadgeTone> = {
  positive: 'green',
  negative: 'miss',
  neutral: 'blue',
};

const CHARGE_LABEL: Record<Charge, string> = {
  positive: 'positive',
  negative: 'negative',
  neutral: 'neutral',
};

/** One root/prefix/suffix: the piece, its meaning, charge tag, and examples. */
export function MorphemeCard({ morpheme }: { morpheme: MorphemeCardData }) {
  return (
    <Card interactive className="h-full">
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span className="accent-serif text-h3 text-ink-900">{morpheme.text}</span>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone="neutral">{morpheme.type}</Badge>
            {morpheme.charge && (
              <Badge tone={CHARGE_TONE[morpheme.charge]}>{CHARGE_LABEL[morpheme.charge]}</Badge>
            )}
          </div>
        </div>

        <p className="text-body text-ink-700">{morpheme.meaning}</p>

        {morpheme.exampleWords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {morpheme.exampleWords.map((w) => (
              <span
                key={w}
                className="rounded-pill bg-sunken px-2 py-0.5 text-micro text-ink-500"
              >
                {w}
              </span>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
