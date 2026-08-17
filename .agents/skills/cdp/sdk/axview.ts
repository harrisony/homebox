/**
 * Compressed accessibility-tree view — a projection over a raw
 * `Accessibility.getFullAXTree` (or `queryAXTree`) result, NOT a replacement
 * for the CDP call. The agent still fetches the nodes; `axView` renders them
 * compactly so a full-page snapshot fits in context.
 *
 * Raw `getFullAXTree` is unusable in context: a real page returns thousands of
 * nodes, hundreds of thousands of tokens, full of `sources` / `chromeRole` /
 * `InlineTextBox` noise. `axView` drops the ~96% that is structural, keeps every
 * interactive node, heading, landmark, and text node, and assigns `[n]` refs
 * mapped to `backendDOMNodeId` so the agent can act on them.
 *
 * Measured (cl100k_base): a Wikipedia article 886K -> 22K tokens; an app page
 * 210K -> 7K. All interactive nodes and content preserved.
 *
 * Pure — takes already-fetched nodes, returns a string. No session, no CDP
 * calls. Injected as the `axView` global in the REPL (see `repl.ts`), along with
 * `axDiff` / `parseAxRefs`. For heuristics, escalation, and acting on refs, see
 * `interaction-skills/snapshot.md`.
 */

export type AxViewOptions = {
  /** Include trailing `# refs -> backendDOMNodeId` map. Default true. */
  refs?: boolean;
  /**
   * Keep only actionable structure: interactive roles + landmarks.
   * Drops bulk StaticText / named content. Prefer this first on unfamiliar pages.
   */
  interactive?: boolean;
  /** Max emit depth from the root (0 = root only). Default unlimited. */
  maxDepth?: number;
  /**
   * Redact sensitive control values (password-ish textboxes, protected fields).
   * Default true. Names/labels stay visible; values become `[redacted]`.
   */
  redactSensitive?: boolean;
};

const LEAF = new Set([
  'InlineTextBox',
  'LineBreak',
  'ListMarker',
  'ContentInsertion',
  'ContentDeletion',
]);

const INT = new Set([
  'link',
  'button',
  'textbox',
  'searchbox',
  'spinbutton',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'slider',
  'switch',
  'tab',
  'tablist',
  'tree',
  'treeitem',
  'treegrid',
  'grid',
  'gridcell',
  'rowheader',
  'columnheader',
  'scrollbar',
  'canvas',
]);

const LM = new Set([
  'main',
  'navigation',
  'complementary',
  'banner',
  'contentinfo',
  'form',
  'search',
  'region',
  'article',
  'application',
]);

const DROP = new Set([
  'none',
  'generic',
  'paragraph',
  'section',
  'div',
  'presentation',
  'separator',
  'insertion',
  'deletion',
  'superscript',
  'subscript',
  'Abbr',
  'group',
  'list',
  'listitem',
  'row',
  'rowgroup',
  'cell',
  'table',
  'figure',
  'figcaption',
]);

const SENSITIVE_NAME_RE =
  /\b(password|passwd|passcode|pin|secret|token|ssn|cvv|cvc|card\s*number|account\s*number)\b/i;

function roleOf(n: any): string {
  return n.role?.value || (n.ignored ? 'IGNORED' : 'NONE');
}

function nameOf(n: any): string {
  return (n.name?.value ?? '').replace(/\s+/g, ' ').trim();
}

function propsOf(n: any): Record<string, any> {
  const p: Record<string, any> = {};
  for (const q of n.properties || []) {
    if (q.value && 'value' in q.value) p[q.name] = q.value.value;
  }
  return p;
}

function isSensitive(n: any, r: string, nm: string, p: Record<string, any>): boolean {
  if (p.protected === true) return true;
  if (r !== 'textbox' && r !== 'searchbox' && r !== 'spinbutton') return false;
  return SENSITIVE_NAME_RE.test(nm) || SENSITIVE_NAME_RE.test(String(p.description ?? ''));
}

function keepSelf(
  r: string,
  nm: string,
  interactive: boolean,
): boolean {
  if (LEAF.has(r)) return false;
  if (interactive) {
    // Actionable structure only — matches the "interactive-first" agent default.
    return INT.has(r) || LM.has(r);
  }
  return (
    INT.has(r) ||
    LM.has(r) ||
    r === 'heading' ||
    (r === 'StaticText' && !!nm) ||
    (!!nm && !DROP.has(r))
  );
}

/**
 * Compress an AX node list into an indented tree with `[n]` refs.
 */
export function axView(nodes: any[], opts: AxViewOptions = {}): string {
  const interactive = opts.interactive === true;
  const redactSensitive = opts.redactSensitive !== false;
  const maxDepth = opts.maxDepth;
  const byId = new Map<string, any>();
  for (const n of nodes) if (!byId.has(n.nodeId)) byId.set(n.nodeId, n);

  const root =
    [...byId.values()].find((n) => roleOf(n) === 'RootWebArea') ||
    [...byId.values()].find((n) => !n.ignored);

  const survive = new Set<string>();
  const post = (n: any): boolean => {
    if (!n) return false;
    if (n.ignored) {
      let c = false;
      for (const id of n.childIds || []) if (post(byId.get(id))) c = true;
      return c;
    }
    const r = roleOf(n);
    if (LEAF.has(r)) return false;
    let keep = keepSelf(r, nameOf(n), interactive);
    let cs = false;
    for (const id of n.childIds || []) if (post(byId.get(id))) cs = true;
    // Ancestors of kept descendants must survive so emit can reach them.
    // In interactive mode children that are pure StaticText never keep, so this
    // does not re-introduce bulk prose — only structure wrapping actions/landmarks.
    if (cs) keep = true;
    if (keep) survive.add(n.nodeId);
    return keep;
  };
  post(root);

  // Coalesce redundant text children: a node whose name equals its subtree's
  // text keeps just the node line (e.g. `link "Donate"` drops `StaticText "Donate"`).
  const suppress = new Set<string>();
  const leaves = (n: any, a: any[]) => {
    if (!n || !survive.has(n.nodeId)) return;
    if (roleOf(n) === 'StaticText') {
      a.push(n);
      return;
    }
    for (const id of n.childIds || []) leaves(byId.get(id), a);
  };
  for (const n of byId.values()) {
    if (!survive.has(n.nodeId) || roleOf(n) === 'StaticText') continue;
    const nm = nameOf(n);
    if (!nm) continue;
    const L: any[] = [];
    leaves(n, L);
    if (!L.length) continue;
    if (
      L.map((l) => nameOf(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim() === nm
    ) {
      for (const l of L) suppress.add(l.nodeId);
    }
  }

  const ref = new Map<string, number>();
  const back = new Map<number, number>();
  let rn = 0;

  const flags = (n: any, r: string, nm: string): string => {
    const p = propsOf(n);
    const f: string[] = [];
    if (p.focused) f.push('focused');
    if (p.checked === true || p.checked === 'true') f.push('checked');
    else if (p.checked === 'mixed') f.push('mixed');
    if (p.selected === true) f.push('selected');
    if (p.expanded === true) f.push('expanded');
    if (p.disabled) f.push('disabled');
    if (p.required) f.push('required');
    if (p.pressed === true || p.pressed === 'true') f.push('pressed');
    if (p.scrollable === true) f.push('scrollable');
    let e = '';
    if ('level' in p) e = ` (h${p.level})`;
    if ('value' in p && p.value != null && p.value !== '') {
      const sensitive = redactSensitive && isSensitive(n, r, nm, p);
      const raw = sensitive ? '[redacted]' : String(p.value).slice(0, 40);
      e += ` ="${raw}"`;
    }
    return f.length ? ` <${f.join(' ')}>` + e : e;
  };

  // Sensitive textboxes: suppress value-bearing StaticText descendants (Chrome often
  // nests the bullet mask under a generic wrapper, not as a direct child).
  if (redactSensitive) {
    const suppressDescendantText = (n: any) => {
      if (!n) return;
      if (roleOf(n) === 'StaticText') suppress.add(n.nodeId);
      for (const id of n.childIds || []) suppressDescendantText(byId.get(id));
    };
    for (const n of byId.values()) {
      if (!survive.has(n.nodeId)) continue;
      const r = roleOf(n);
      const nm = nameOf(n);
      if (!isSensitive(n, r, nm, propsOf(n))) continue;
      for (const id of n.childIds || []) suppressDescendantText(byId.get(id));
    }
  }

  const out: string[] = [];
  const emit = (n: any, d: number) => {
    if (!n || suppress.has(n.nodeId)) return;
    if (maxDepth != null && d > maxDepth) return;
    const r = roleOf(n);
    if (
      n.ignored ||
      (DROP.has(r) && !LM.has(r) && !INT.has(r) && r !== 'heading')
    ) {
      for (const id of n.childIds || []) emit(byId.get(id), d);
      return;
    }
    if (!survive.has(n.nodeId)) return;
    const nm = nameOf(n);
    const p = propsOf(n);
    const sensitive = redactSensitive && isSensitive(n, r, nm, p);
    let rid = '';
    if (
      n.backendDOMNodeId &&
      (INT.has(r) || r === 'heading' || (r !== 'StaticText' && nm))
    ) {
      if (!ref.has(n.nodeId)) {
        rn++;
        ref.set(n.nodeId, rn);
        back.set(rn, n.backendDOMNodeId);
      }
      rid = `[${ref.get(n.nodeId)}] `;
    }
    // Mark sensitive fields even when Chrome omits properties.value.
    const extra = sensitive && !('value' in p && p.value != null && p.value !== '')
      ? ' ="[redacted]"'
      : '';
    out.push('  '.repeat(d) + rid + r + (nm ? ` "${nm}"` : '') + flags(n, r, nm) + extra);
    if (maxDepth != null && d >= maxDepth) return;
    for (const id of n.childIds || []) emit(byId.get(id), d + 1);
  };
  emit(root, 0);

  if (opts.refs !== false) {
    out.push(
      '',
      '# refs -> backendDOMNodeId',
      [...back.entries()].map(([r, b]) => `[${r}]=${b}`).join(' '),
    );
  }
  return out.join('\n');
}

/**
 * Parse the trailing `# refs -> backendDOMNodeId` map from an `axView` string.
 * Returns a Map of ref number → backendDOMNodeId. Empty if the map was omitted.
 */
export function parseAxRefs(view: string): Map<number, number> {
  const map = new Map<number, number>();
  if (!view) return map;
  const marker = view.lastIndexOf('# refs -> backendDOMNodeId');
  if (marker < 0) return map;
  const tail = view.slice(marker);
  for (const m of tail.matchAll(/\[(\d+)\]=(\d+)/g)) {
    map.set(Number(m[1]), Number(m[2]));
  }
  return map;
}

/** Normalize a tree line for diffing: drop `[n]` refs (renumbered every snapshot). */
function normalizeLine(line: string): string {
  return line.replace(/\[\d+\]\s+/g, '');
}

/**
 * Structural diff of two `axView` strings. Refs are stripped before compare
 * (they renumber every snapshot). Unchanged lines are omitted.
 *
 * Output:
 * ```
 * - button "Log in"
 * + button "Log out"
 * ```
 */
export function axDiff(prev: string, next: string): string {
  const lines = (s: string) =>
    (s || '')
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => {
        if (!l.trim()) return false;
        if (l.startsWith('# refs')) return false;
        // ref-map payload line(s)
        if (/^(\[\d+\]=\d+\s*)+$/.test(l.trim())) return false;
        return true;
      })
      .map((l) => ({ raw: l, key: normalizeLine(l) }));

  const a = lines(prev);
  const b = lines(next);
  // LCS on keys
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i]!.key === b[j]!.key
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i]!.key === b[j]!.key) {
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push('- ' + a[i]!.raw.trimStart());
      i++;
    } else {
      out.push('+ ' + b[j]!.raw.trimStart());
      j++;
    }
  }
  while (i < n) {
    out.push('- ' + a[i]!.raw.trimStart());
    i++;
  }
  while (j < m) {
    out.push('+ ' + b[j]!.raw.trimStart());
    j++;
  }
  return out.length ? out.join('\n') : '(no changes)';
}
