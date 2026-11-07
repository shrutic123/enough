export type DiffPart = { text: string; word: boolean; removed: boolean; index: number }

type Token = { text: string; word: boolean }

const TOKEN = /\s+|\S+/g

function tokenize(text: string): Token[] {
  return (text.match(TOKEN) ?? []).map((value) => ({
    text: value,
    // A token matched by \s+ is whitespace; \S+ never contains whitespace.
    word: !/^\s/.test(value),
  }))
}

// Longest common subsequence over word tokens, built back-to-front so the
// walk below can greedily follow an optimal path.
function lcsTable(a: string[], b: string[]): Uint16Array[] {
  const table: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  return table
}

export function diffText(original: string, trimmed: string): DiffPart[] {
  const tokens = tokenize(original)
  const keptWords = tokenize(trimmed)
    .filter((token) => token.word)
    .map((token) => token.text)

  // The positions in `tokens` that hold words, and their text in order.
  const wordPositions: number[] = []
  const originalWords: string[] = []

  tokens.forEach((token, position) => {
    if (!token.word) return
    wordPositions.push(position)
    originalWords.push(token.text)
  })

  const table = lcsTable(originalWords, keptWords)
  const kept = new Set<number>()

  // Walk the LCS. Any word the path skips is a cut.
  let i = 0
  let j = 0
  while (i < originalWords.length && j < keptWords.length) {
    if (originalWords[i] === keptWords[j]) {
      kept.add(wordPositions[i])
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i += 1
    } else {
      j += 1
    }
  }

  // Drop the gap next to a cut so collapsing it can never leave a double
  // space: the following whitespace normally, or the preceding one when the
  // cut ends the text.
  const dropped = new Set<number>()

  tokens.forEach((token, position) => {
    if (!token.word || kept.has(position)) return

    const next = tokens[position + 1]
    if (next && !next.word) {
      dropped.add(position + 1)
      return
    }

    if (position === tokens.length - 1) {
      const previous = tokens[position - 1]
      if (previous && !previous.word) dropped.add(position - 1)
    }
  })

  const parts: DiffPart[] = []
  let cutIndex = 0

  tokens.forEach((token, position) => {
    if (dropped.has(position)) return

    if (token.word && !kept.has(position)) {
      parts.push({ text: token.text, word: true, removed: true, index: cutIndex })
      cutIndex += 1
      return
    }

    parts.push({ text: token.text, word: token.word, removed: false, index: -1 })
  })

  return parts
}

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0
}
