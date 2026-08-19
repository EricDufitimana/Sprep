import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../decode-entities.ts';

describe('decodeEntities', () => {
  it('decodes proper named entities', () => {
    assert.equal(decodeEntities('&Eacute;tienne Zangato'), 'Étienne Zangato');
    assert.equal(decodeEntities('found in &Ocirc;boui and Gbatoro'), 'found in Ôboui and Gbatoro');
    assert.equal(decodeEntities('na&iuml;ve'), 'naïve');
  });

  it('repairs accented names that lost their leading &', () => {
    assert.equal(decodeEntities('Ocirc;boui and Gbatoro'), 'Ôboui and Gbatoro');
    assert.equal(decodeEntities('Eacute;tienne'), 'Étienne');
  });

  it('decodes numeric and hex entities', () => {
    assert.equal(decodeEntities('caf&#233;'), 'café');
    assert.equal(decodeEntities('caf&#xE9;'), 'café');
    assert.equal(decodeEntities('2200&ndash;2000 BCE'), '2200–2000 BCE');
  });

  it('leaves ordinary text, bare &, and prose semicolons untouched', () => {
    assert.equal(decodeEntities('AT&T and R&D'), 'AT&T and R&D');
    assert.equal(decodeEntities('first point; second point'), 'first point; second point');
    assert.equal(decodeEntities('however; the study'), 'however; the study');
    assert.equal(decodeEntities('no entities here'), 'no entities here');
  });

  it('leaves unknown entity names as-is', () => {
    assert.equal(decodeEntities('&notareal;'), '&notareal;');
  });
});
