import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge has to be told about our custom font-size scale.
 *
 * Out of the box it only knows Tailwind's built-in sizes (`text-sm`,
 * `text-lg`, …). Faced with `text-body` it can't tell whether that's a size or
 * a colour, guesses colour, and then drops any real colour that came before it:
 *
 *   twMerge('text-white', 'text-body')  ->  'text-body'   ← white silently lost
 *
 * That bit every element combining a type-scale class with a colour — most
 * visibly buttons, whose variant sets `text-white` and whose size class then
 * erased it. Registering the scale under `font-size` resolves the ambiguity.
 *
 * Keep this list in sync with `fontSize` in tailwind.config.ts.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "small", "body", "lead", "h3", "h2", "h1", "score"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
