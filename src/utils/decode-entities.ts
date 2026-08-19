/**
 * Decode HTML entities left raw in ingested SAT question text.
 *
 * Two failure modes show up in the bank:
 *   1. Proper entities the render layer never decoded — "&Eacute;tienne".
 *   2. Entities whose leading "&" was dropped by an upstream step — "Ocirc;boui".
 *
 * This handles both: numeric (`&#233;`, `&#xE9;`) and named entities with their
 * "&", plus a repair pass for a safe subset of named entities missing the "&".
 * It's pure (no DOM), so it runs identically on server and client — no hydration
 * mismatch — and it leaves unrecognised `&…;`, bare `&` (AT&T, R&D), and ordinary
 * semicolons untouched.
 */

/** Named entities → codepoint. Full Latin-1 letter set plus the punctuation and
 *  symbols SAT prose uses. */
const NAMED_ENTITIES: Record<string, number> = {
  amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, nbsp: 160,
  iexcl: 161, cent: 162, pound: 163, curren: 164, yen: 165, brvbar: 166, sect: 167,
  uml: 168, copy: 169, ordf: 170, laquo: 171, not: 172, shy: 173, reg: 174, macr: 175,
  deg: 176, plusmn: 177, sup2: 178, sup3: 179, acute: 180, micro: 181, para: 182,
  middot: 183, cedil: 184, sup1: 185, ordm: 186, raquo: 187, frac14: 188, frac12: 189,
  frac34: 190, iquest: 191,
  Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198,
  Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203, Igrave: 204, Iacute: 205,
  Icirc: 206, Iuml: 207, ETH: 208, Ntilde: 209, Ograve: 210, Oacute: 211, Ocirc: 212,
  Otilde: 213, Ouml: 214, times: 215, Oslash: 216, Ugrave: 217, Uacute: 218, Ucirc: 219,
  Uuml: 220, Yacute: 221, THORN: 222, szlig: 223, agrave: 224, aacute: 225, acirc: 226,
  atilde: 227, auml: 228, aring: 229, aelig: 230, ccedil: 231, egrave: 232, eacute: 233,
  ecirc: 234, euml: 235, igrave: 236, iacute: 237, icirc: 238, iuml: 239, eth: 240,
  ntilde: 241, ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, divide: 247,
  oslash: 248, ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, thorn: 254,
  yuml: 255,
  ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218, ldquo: 8220,
  rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230,
  permil: 8240, prime: 8242, Prime: 8243, lsaquo: 8249, rsaquo: 8250, euro: 8364,
  trade: 8482, minus: 8722, le: 8804, ge: 8805, ne: 8800,
};

/**
 * Names safe to decode even without a leading "&". Restricted to names that are
 * never ordinary English words, so a real semicolon in prose ("first; second")
 * is never mistaken for an entity. Accented letters + dashes/quotes only.
 */
const BARE_SAFE = new Set<string>([
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil', 'Egrave',
  'Eacute', 'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml', 'Ntilde', 'Ograve',
  'Oacute', 'Ocirc', 'Otilde', 'Ouml', 'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml',
  'Yacute', 'szlig', 'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig',
  'ccedil', 'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml',
  'ntilde', 'ograve', 'oacute', 'ocirc', 'otilde', 'ouml', 'oslash', 'ugrave', 'uacute',
  'ucirc', 'uuml', 'yacute', 'ndash', 'mdash', 'lsquo', 'rsquo', 'ldquo', 'rdquo', 'hellip',
]);

function fromCodePoint(cp: number): string | null {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return null;
  }
}

export function decodeEntities(text: string): string {
  if (!text.includes('&') && !text.includes(';')) return text;
  let out = text;
  if (out.includes('&')) {
    out = out.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
      if (body[0] === '#') {
        const cp =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return fromCodePoint(cp) ?? whole;
      }
      const cp = NAMED_ENTITIES[body];
      return cp != null ? String.fromCodePoint(cp) : whole;
    });
  }
  if (out.includes(';')) {
    out = out.replace(/([A-Za-z]{2,10});/g, (whole, name: string) => {
      const cp = BARE_SAFE.has(name) ? NAMED_ENTITIES[name] : undefined;
      return cp != null ? String.fromCodePoint(cp) : whole;
    });
  }
  return out;
}
